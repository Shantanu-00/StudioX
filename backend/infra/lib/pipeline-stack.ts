import * as path from 'path';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

const { JsonPath } = sfn;
const AGENTS = ['analyst', 'coviewer'];

/**
 * The analysis pipeline: Step Functions "StudioX-EpisodeAnalysis" plus its Lambdas, an EventBridge rule
 * on uploads, a Bedrock Guardrail and the SSM parameters that wire in the AgentCore runtimes.
 * The bucket and table come from StudioXCore through SSM (/studiox/bucket, /studiox/table), so deploy
 * StudioXCore first.
 */
export class StudioXPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const stack = cdk.Stack.of(this);

    const bucketName = ssm.StringParameter.valueForStringParameter(this, '/studiox/bucket');
    const tableName = ssm.StringParameter.valueForStringParameter(this, '/studiox/table');
    const bucketArn = stack.formatArn({ service: 's3', resource: bucketName, region: '', account: '' });
    const tableArn = stack.formatArn({ service: 'dynamodb', resource: 'table', resourceName: tableName });
    const objects = (prefix: string) => `${bucketArn}/${prefix}`;
    const paramArn = (name: string) => stack.formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1) });

    // ---- Parameters the agents and the API read at runtime --------------------------------------------
    for (const agent of AGENTS) {
      // 'unset' until `agentcore deploy`; then `aws ssm put-parameter --overwrite` (CloudFormation leaves it).
      new ssm.StringParameter(this, `Agent-${agent}`, {
        parameterName: `/studiox/agents/${agent}/arn`,
        stringValue: 'unset',
      });
    }

    // ---- Bedrock Guardrail: contextual grounding for cards, prompt-attack screen for viewer questions ----
    const guardrail = new bedrock.CfnGuardrail(this, 'Guardrail', {
      name: 'studiox-grounding',
      description: 'Grounds every card in the transcript; screens viewer questions for prompt attacks.',
      blockedInputMessaging: 'That question cannot be answered.',
      blockedOutputsMessaging: 'That answer was withheld because it could not be grounded.',
      contentPolicyConfig: {
        filtersConfig: [{ type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' }],
      },
      contextualGroundingPolicyConfig: {
        filtersConfig: [
          { type: 'GROUNDING', threshold: 0.7 },
          { type: 'RELEVANCE', threshold: 0.7 },
        ],
      },
    });
    const guardrailVersion = new bedrock.CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: 'grounding 0.7 / relevance 0.7 / prompt attack HIGH',
    });
    new ssm.StringParameter(this, 'GuardrailId', {
      parameterName: '/studiox/guardrail/id', stringValue: guardrail.attrGuardrailId,
    });
    new ssm.StringParameter(this, 'GuardrailVersionParam', {
      parameterName: '/studiox/guardrail/version', stringValue: guardrailVersion.attrVersion,
    });

    // ---- Lambdas ---------------------------------------------------------------------------------------
    const layers: lambda.ILayerVersion[] = [];
    const sharedDir = path.join(__dirname, '../../shared');
    if (fs.existsSync(path.join(sharedDir, 'python', 'studiox_core'))) {
      layers.push(new lambda.LayerVersion(this, 'CoreLayer', {
        code: lambda.Code.fromAsset(sharedDir, { exclude: ['tests', '**/tests', '__pycache__', '**/__pycache__', '*.pyc', '.pytest_cache'] }),
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
        description: 'studiox_core: widget schema, verdict table, package assembly, transcript helpers',
      }));
    } else {
      cdk.Annotations.of(this).addWarning('backend/shared/python/studiox_core not found: Verify and Publish will fail until it exists');
    }
    const code = lambda.Code.fromAsset(path.join(__dirname, '../../functions/pipeline'), {
      exclude: ['tests', '__pycache__', '.pytest_cache', '*.pyc'],
    });
    const env = { TABLE_NAME: tableName, BUCKET_NAME: bucketName };
    const fn = (name: string, handler: string, opts: { timeout: number; memory?: number; layers?: boolean; env?: Record<string, string> }) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.PYTHON_3_13,
        handler,
        code,
        memorySize: opts.memory ?? 256,
        timeout: cdk.Duration.seconds(opts.timeout),
        layers: opts.layers ? layers : undefined,
        environment: { ...env, ...opts.env },
      });
    const allow = (f: lambda.Function, actions: string[], resources: string[]) =>
      f.addToRolePolicy(new iam.PolicyStatement({ actions, resources }));
    const dynamo = (f: lambda.Function) =>
      allow(f, ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem'], [tableArn]);

    const setStatus = fn('SetStatusFn', 'set_status.handler', { timeout: 15 });
    dynamo(setStatus);

    const normalise = fn('NormaliseFn', 'normalise.handler', { timeout: 120, memory: 512, layers: true });
    dynamo(normalise);
    allow(normalise, ['s3:GetObject', 's3:PutObject'], [objects('runs/*'), objects('transcripts/*')]);

    const invokeAgent = fn('InvokeAgentFn', 'invoke_agent.handler', { timeout: 900 });
    dynamo(invokeAgent);
    allow(invokeAgent, ['ssm:GetParameter'], [paramArn('/studiox/agents/*')]);
    allow(invokeAgent, ['bedrock-agentcore:InvokeAgentRuntime'], [
      stack.formatArn({ service: 'bedrock-agentcore', resource: 'runtime', resourceName: '*' }),
    ]);
    allow(invokeAgent, ['s3:GetObject', 's3:PutObject'], [objects('runs/*')]);
    allow(invokeAgent, ['s3:GetObject'], [objects('transcripts/*')]);

    const verify = fn('VerifyFn', 'verify.handler', { timeout: 300, memory: 512, layers: true });
    dynamo(verify);
    allow(verify, ['s3:GetObject'], [objects('transcripts/*')]);
    allow(verify, ['s3:GetObject', 's3:PutObject'], [objects('runs/*')]);
    allow(verify, ['ssm:GetParameter'], [paramArn('/studiox/guardrail/*')]);
    allow(verify, ['bedrock:ApplyGuardrail'], [guardrail.attrGuardrailArn]);

    const publish = fn('PublishFn', 'publish.handler', { timeout: 60, memory: 512, layers: true });
    dynamo(publish);
    allow(publish, ['s3:GetObject'], [objects('transcripts/*'), objects('runs/*')]);
    allow(publish, ['s3:PutObject'], [objects('packages/*')]);

    const start = fn('StartPipelineFn', 'start_pipeline.handler', { timeout: 15 });
    dynamo(start);

    // Playback preparation needs the static ffmpeg layer (backend/scripts/fetch_ffmpeg.sh); without the binary
    // the stack still synthesises, minus the playback branch.
    const ffmpegDir = path.join(__dirname, '../../layers/ffmpeg');
    let preparePlayback: lambda.Function | undefined;
    if (fs.existsSync(path.join(ffmpegDir, 'bin', 'ffmpeg')) && fs.existsSync(path.join(ffmpegDir, 'bin', 'ffprobe'))) {
      const ffmpegLayer = new lambda.LayerVersion(this, 'FfmpegLayer', {
        code: lambda.Code.fromAsset(ffmpegDir),
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
        compatibleArchitectures: [lambda.Architecture.X86_64],
        description: 'Static ffmpeg and ffprobe at /opt/bin',
      });
      preparePlayback = new lambda.Function(this, 'PreparePlaybackFn', {
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.X86_64,
        handler: 'prepare_playback.handler',
        code,
        memorySize: 3008,
        timeout: cdk.Duration.minutes(15),
        ephemeralStorageSize: cdk.Size.gibibytes(10),
        layers: [ffmpegLayer],
        environment: env,
      });
      dynamo(preparePlayback);
      allow(preparePlayback, ['s3:GetObject'], [objects('uploads/*')]);
      allow(preparePlayback, ['s3:PutObject'], [objects('media/*')]);
      allow(preparePlayback, ['ssm:GetParameter'], [paramArn('/studiox/domain')]);
    } else {
      cdk.Annotations.of(this).addWarning('backend/layers/ffmpeg/bin/{ffmpeg,ffprobe} not found (run backend/scripts/fetch_ffmpeg.sh): synthesising without the Prepare playback branch');
    }

    // ---- State machine ---------------------------------------------------------------------------------
    const exec = JsonPath.stringAt('$$.Execution.Name');
    const lambdaTask = (id: string, f: lambda.Function, payload: Record<string, unknown>, opts: Partial<tasks.LambdaInvokeProps> = {}) =>
      new tasks.LambdaInvoke(this, id, {
        stateName: id,
        lambdaFunction: f,
        payload: sfn.TaskInput.fromObject(payload),
        payloadResponseOnly: true,
        ...opts,
      });
    const agentTask = (id: string, payload: Record<string, unknown>, opts: Partial<tasks.LambdaInvokeProps> = {}) =>
      lambdaTask(id, invokeAgent, payload, { retryOnServiceExceptions: false, taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(930)), ...opts });

    // Failure path shared by every step.
    const markFailed = lambdaTask('Mark failed', setStatus, {
      mediaId: JsonPath.stringAt('$.mediaId'),
      state: 'FAILED',
      error: JsonPath.stringAt('$.error.Cause'),
    }, { resultPath: JsonPath.DISCARD });
    const failed = markFailed.next(new sfn.Fail(this, 'Analysis failed', { error: 'AnalysisFailed' }));
    const guard = <T extends sfn.TaskStateBase>(s: T): T => {
      s.addCatch(failed, { resultPath: '$.error' });
      return s;
    };

    const markProcessing = guard(lambdaTask('Mark processing', setStatus, {
      mediaId: JsonPath.stringAt('$.mediaId'),
      input: JsonPath.objectAt('$'),
      state: 'PROCESSING',
      progress: 0.05,
      text: 'Getting started',
    }, { resultPath: JsonPath.DISCARD }));

    const normaliseTask = guard(lambdaTask('Normalise transcript', normalise, {
      mediaId: JsonPath.stringAt('$.mediaId'),
      execution: exec,
      input: JsonPath.objectAt('$'),
    }, { resultPath: '$.norm' }));

    const notFit = lambdaTask('Not a fit', setStatus, {
      mediaId: JsonPath.stringAt('$.mediaId'),
      state: 'NOT_A_FIT',
      speechPct: JsonPath.numberAt('$.norm.speechPct'),
    }, { resultPath: JsonPath.DISCARD });
    guard(notFit);

    const findTopics = guard(agentTask('Find topics', {
      agent: 'analyst',
      payload: {
        mode: 'segment',
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
      },
      run: { mediaId: JsonPath.stringAt('$.mediaId'), execution: exec, name: 'segments' },
      inline: true,
      status: { state: 'ANALYSING', progress: 0.35, text: 'Finding topics' },
    }, { resultPath: '$.seg' }));

    // Per segment: run the lenses; one failed segment must not sink the episode.
    const runLenses = agentTask('Run lenses', {
      agent: 'analyst',
      payload: {
        mode: 'lenses',
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.transcriptKey'),
        segment: JsonPath.objectAt('$.segment'),
        brief: { cast: JsonPath.objectAt('$.speakers'), recaps: [] },
      },
      run: {
        mediaId: JsonPath.stringAt('$.mediaId'),
        execution: JsonPath.stringAt('$.execution'),
        name: JsonPath.format('seg-{}', JsonPath.stringAt('$.index')),
      },
      meta: { index: JsonPath.numberAt('$.index') },
    });
    runLenses.addCatch(new sfn.Pass(this, 'Segment skipped', {
      parameters: { skipped: true, 'index.$': '$.index', 'error.$': '$.error.Cause' },
    }), { resultPath: '$.error' });
    const analyseSegments = new sfn.Map(this, 'Analyse segments', {
      stateName: 'Analyse segments',
      itemsPath: '$.seg.result.segments',
      itemSelector: {
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
        execution: exec,
        speakers: JsonPath.objectAt('$.seg.result.speakers'),
        segment: JsonPath.objectAt('$$.Map.Item.Value'),
        index: JsonPath.numberAt('$$.Map.Item.Index'),
      },
      maxConcurrency: 4,
      resultPath: '$.lanes',
    });
    analyseSegments.itemProcessor(runLenses);
    analyseSegments.addCatch(failed, { resultPath: '$.error' });

    const verifyTask = guard(lambdaTask('Verify and score', verify, {
      mediaId: JsonPath.stringAt('$.mediaId'),
      transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
      execution: exec,
      segments: JsonPath.listAt('$.seg.result.segments'),
      lanes: JsonPath.listAt('$.lanes'),
    }, { resultPath: '$.verified', taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(330)) }));

    const plan = guard(agentTask('Plan the screen', {
      agent: 'analyst',
      payload: {
        mode: 'curate',
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
        segments: JsonPath.listAt('$.seg.result.segments'),
      },
      payloadRefs: { candidates: JsonPath.format('{}#candidates', JsonPath.stringAt('$.verified.key')) },
      run: { mediaId: JsonPath.stringAt('$.mediaId'), execution: exec, name: 'curate' },
      inline: true,
      status: { state: 'ANALYSING', progress: 0.8, text: 'Planning the screen' },
    }, { resultPath: '$.curate' }));

    // The Map author: one picture of the conversation (CONTRACTS section 9). Optional: on failure the
    // episode ships without a map and the curator's questions are answered as before.
    const drawMap = agentTask('Draw the map', {
      agent: 'analyst',
      payload: {
        mode: 'map',
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
        segments: JsonPath.listAt('$.seg.result.segments'),
        pinned: JsonPath.listAt('$.norm.options.pinnedQuestions'),
      },
      // The curator's fields are copied by the Lambda, not by JSONPath: a path to a missing field (`labels`
      // from a curator runtime older than 23 Oct) is a States.Runtime error that no Catch handles, so the
      // whole execution would fail without reaching `Map skipped` or `Mark failed`.
      pick: { from: JsonPath.objectAt('$.curate.result'), keys: ['widgetIds', 'labels', 'moments', 'questions'] },
      payloadRefs: { candidates: JsonPath.format('{}#candidates', JsonPath.stringAt('$.verified.key')) },
      run: { mediaId: JsonPath.stringAt('$.mediaId'), execution: exec, name: 'map' },
      inline: true,
      status: { state: 'ANALYSING', progress: 0.85, text: 'Drawing the map' },
    }, { resultPath: '$.map' });
    const mapSkipped = new sfn.Pass(this, 'Map skipped', {
      parameters: {
        result: {
          explore: { eligible: false, reason: 'The map could not be drawn' },
          'questions.$': '$.curate.result.questions',
        },
      },
      resultPath: '$.map',
    });
    drawMap.addCatch(mapSkipped, { resultPath: '$.mapError' });

    const answerOne = agentTask('Answer one question', {
      agent: 'analyst',
      payload: {
        mode: 'answer',
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.transcriptKey'),
        t: JsonPath.numberAt('$.question.t'),
        question: JsonPath.stringAt('$.question.question'),
      },
      run: {
        mediaId: JsonPath.stringAt('$.mediaId'),
        execution: JsonPath.stringAt('$.execution'),
        name: JsonPath.format('answer-{}', JsonPath.stringAt('$.index')),
      },
      inline: true,
      // {t, question, mapNode?}: map questions carry the node they belong to
      meta: JsonPath.objectAt('$.question'),
    });
    answerOne.addCatch(new sfn.Pass(this, 'Answer skipped', {
      parameters: { skipped: true, 'error.$': '$.error.Cause' },
    }), { resultPath: '$.error' });
    const precompute = new sfn.Map(this, 'Precompute answers', {
      stateName: 'Precompute answers',
      itemsPath: '$.map.result.questions', // the curator's questions plus the map's
      itemSelector: {
        mediaId: JsonPath.stringAt('$.mediaId'),
        transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
        execution: exec,
        question: JsonPath.objectAt('$$.Map.Item.Value'),
        index: JsonPath.numberAt('$$.Map.Item.Index'),
      },
      maxConcurrency: 4,
      resultPath: '$.answers',
    });
    precompute.itemProcessor(answerOne);
    precompute.addCatch(failed, { resultPath: '$.error' });

    const publishTask = guard(lambdaTask('Publish package', publish, {
      mediaId: JsonPath.stringAt('$.mediaId'),
      execution: exec,
      transcriptKey: JsonPath.stringAt('$.norm.transcriptKey'),
      seg: JsonPath.objectAt('$.seg.result'),
      verifiedKey: JsonPath.stringAt('$.verified.key'),
      curate: JsonPath.objectAt('$.curate.result'),
      map: JsonPath.objectAt('$.map.result'),
      options: JsonPath.objectAt('$.norm.options'),
      answers: JsonPath.listAt('$.answers'),
    }, { resultPath: JsonPath.DISCARD }));

    const missingInput = new sfn.Pass(this, 'Nothing to analyse', {
      result: sfn.Result.fromObject({ Cause: 'The input has neither transcriptKey nor mediaKey' }),
      resultPath: '$.error',
    }).next(failed);

    const eligibility = new sfn.Choice(this, 'Eligibility gate')
      .when(sfn.Condition.or(
        sfn.Condition.numberLessThan('$.norm.speechRatio', 0.3),
        sfn.Condition.numberLessThan('$.norm.wpm', 40),
      ), notFit.next(new sfn.Succeed(this, 'Skipped: not a fit')))
      .otherwise(findTopics);

    normaliseTask.next(eligibility);
    findTopics.next(analyseSegments).next(verifyTask).next(plan).next(drawMap).next(precompute).next(publishTask)
      .next(new sfn.Succeed(this, 'Ready to watch'));
    mapSkipped.next(precompute);

    // Upload path: Amazon Transcribe, then Normalise. With the ffmpeg layer it runs in a Parallel branch beside
    // Prepare playback; each branch ends at its Normalise step and the Parallel state carries on to the gate.
    const transcribeChain = (inBranch: boolean) => {
      const g = <T extends sfn.TaskStateBase>(t: T): T => (inBranch ? t : guard(t));
      const jobName = JsonPath.format('studiox-{}-{}', JsonPath.stringAt('$.mediaId'), exec);
      const jobArn = [stack.formatArn({ service: 'transcribe', resource: 'transcription-job', resourceName: 'studiox-*' })];
      const transcribe = g(new tasks.CallAwsService(this, 'Transcribe speech', {
        stateName: 'Transcribe speech',
        service: 'transcribe',
        action: 'startTranscriptionJob',
        parameters: {
          TranscriptionJobName: jobName,
          LanguageCode: 'en-US',
          Media: { MediaFileUri: JsonPath.format(`s3://${bucketName}/{}`, JsonPath.stringAt('$.mediaKey')) },
          OutputBucketName: bucketName,
          OutputKey: JsonPath.format('runs/{}/{}/transcribe.json', JsonPath.stringAt('$.mediaId'), exec),
          Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 4 },
        },
        iamResources: jobArn,
        resultPath: JsonPath.DISCARD,
      }));
      transcribe.addRetry({ errors: ['Transcribe.LimitExceededException'], interval: cdk.Duration.seconds(30), maxAttempts: 5, backoffRate: 2 });
      const wait = new sfn.Wait(this, 'Wait', { stateName: 'Wait', time: sfn.WaitTime.duration(cdk.Duration.seconds(20)) });
      const check = g(new tasks.CallAwsService(this, 'Check transcription', {
        stateName: 'Check transcription',
        service: 'transcribe',
        action: 'getTranscriptionJob',
        parameters: { TranscriptionJobName: jobName },
        iamResources: jobArn,
        resultSelector: { 'status.$': '$.TranscriptionJob.TranscriptionJobStatus' },
        resultPath: '$.job',
      }));
      check.addRetry({
        errors: ['Transcribe.LimitExceededException', 'Transcribe.InternalFailureException'],
        interval: cdk.Duration.seconds(10), maxAttempts: 4, backoffRate: 2,
      });
      const normaliseUpload = inBranch
        ? lambdaTask('Normalise upload transcript', normalise, {
          mediaId: JsonPath.stringAt('$.mediaId'),
          execution: exec,
          input: JsonPath.objectAt('$'),
        }, { resultPath: '$.norm' })
        : normaliseTask;
      const done = new sfn.Choice(this, 'Transcription finished?')
        .when(sfn.Condition.stringEquals('$.job.status', 'COMPLETED'), normaliseUpload)
        .when(sfn.Condition.stringEquals('$.job.status', 'FAILED'), inBranch
          ? new sfn.Fail(this, 'Transcription failed', { error: 'TranscriptionFailed', cause: 'Amazon Transcribe could not transcribe the media' })
          : new sfn.Pass(this, 'Transcription failed', {
            result: sfn.Result.fromObject({ Cause: 'Amazon Transcribe could not transcribe the media' }),
            resultPath: '$.error',
          }).next(failed))
        .otherwise(wait);
      transcribe.next(wait).next(check).next(done);
      return transcribe;
    };

    let uploadPath: sfn.IChainable;
    if (preparePlayback) {
      const prepare = lambdaTask('Prepare playback', preparePlayback, {
        mediaId: JsonPath.stringAt('$.mediaId'),
        mediaKey: JsonPath.stringAt('$.mediaKey'),
      }, { resultPath: JsonPath.DISCARD, taskTimeout: sfn.Timeout.duration(cdk.Duration.minutes(16)) });
      prepare.addCatch(new sfn.Pass(this, 'Playback skipped'), { resultPath: JsonPath.DISCARD });
      const both = new sfn.Parallel(this, 'Prepare playback and transcribe', {
        stateName: 'Prepare playback and transcribe',
        resultSelector: { 'mediaId.$': '$[1].mediaId', 'norm.$': '$[1].norm' },
      });
      both.branch(prepare);
      both.branch(transcribeChain(true));
      both.addCatch(failed, { resultPath: '$.error' });
      both.next(eligibility);
      uploadPath = both;
    } else {
      uploadPath = transcribeChain(false);
    }

    const hasTranscript = new sfn.Choice(this, 'Has transcript?', { stateName: 'Has transcript?' })
      .when(sfn.Condition.isPresent('$.transcriptKey'), normaliseTask)
      .when(sfn.Condition.isPresent('$.mediaKey'), uploadPath)
      .otherwise(missingInput);

    const definition = markProcessing.next(hasTranscript);

    const logGroup = new logs.LogGroup(this, 'StateMachineLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const machine = new sfn.StateMachine(this, 'EpisodeAnalysis', {
      stateMachineName: 'StudioX-EpisodeAnalysis',
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.hours(3),
      logs: { destination: logGroup, level: sfn.LogLevel.ERROR },
      tracingEnabled: true,
    });
    // Transcribe reads the upload and writes its output with the state machine's own permissions.
    machine.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [objects('uploads/*')] }));
    // Transcribe also writes a `.write_access_check_file.temp` probe before the job. Its key is not documented
    // in the API reference; runs/* covers it under the output prefix and the root key is allowed as well.
    machine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'], resources: [objects('runs/*'), objects('.write_access_check_file.temp')],
    }));

    // ---- Start on upload -------------------------------------------------------------------------------
    start.addEnvironment('STATE_MACHINE_ARN', machine.stateMachineArn);
    machine.grantStartExecution(start);
    new events.Rule(this, 'OnUpload', {
      description: 'A finished upload under uploads/ starts StudioX-EpisodeAnalysis',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: { bucket: { name: [bucketName] }, object: { key: [{ prefix: 'uploads/' }] } },
      },
      targets: [new targets.LambdaFunction(start, { retryAttempts: 1 })],
    });

    new cdk.CfnOutput(this, 'StateMachineArn', { value: machine.stateMachineArn });
    new cdk.CfnOutput(this, 'GuardrailIdOutput', { value: guardrail.attrGuardrailId });
  }
}
