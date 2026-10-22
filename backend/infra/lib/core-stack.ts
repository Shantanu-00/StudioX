import * as path from 'path';
import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

const DOMAIN_PARAM = '/studiox/domain';
const LIVE_PARAM = '/studiox/live';
const ACCESS_PARAM = '/studiox/access-code';
const GUARDRAIL_ID_PARAM = '/studiox/guardrail/id';
const GUARDRAIL_VERSION_PARAM = '/studiox/guardrail/version';
const COVIEWER_PARAM = '/studiox/agents/coviewer/arn';

export class StudioXCoreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Key layout: uploads/<mediaId>/<name>, link/ (phone web app), packages/, images/, media/
    const bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      eventBridgeEnabled: true, // StudioXPipeline starts on Object Created under uploads/
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
      cors: [{
        allowedOrigins: ['*'],
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag'],
        maxAge: 3000,
      }],
    });

    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'studiox',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiFn = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../functions/api'), {
        exclude: ['tests', '__pycache__', '.pytest_cache', '*.pyc'],
      }),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30), // phone questions are answered synchronously by the coviewer
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
        DOMAIN_PARAM,
        LIVE_PARAM,
        ACCESS_PARAM,
        GUARDRAIL_ID_PARAM,
        GUARDRAIL_VERSION_PARAM,
        COVIEWER_PARAM,
        QUOTA_LIMIT: '300',
      },
    });
    table.grantReadWriteData(apiFn);
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
      resources: [bucket.arnForObjects('uploads/*')],
    }));
    // ARN built as a string (not from the parameter construct) to keep the dependency graph acyclic.
    // The live/agent/guardrail parameters are owned by this stack (live, access code) or by StudioXPipeline
    // (agents, guardrail); the Lambda only reads them by name at runtime.
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [DOMAIN_PARAM, LIVE_PARAM, ACCESS_PARAM, GUARDRAIL_ID_PARAM, GUARDRAIL_VERSION_PARAM, COVIEWER_PARAM]
        .map((name) => cdk.Stack.of(this).formatArn({
          service: 'ssm', resource: 'parameter', resourceName: name.slice(1),
        })),
    }));
    // Episode listing checks whether packages/<id>/latest.json exists (list with prefix, no GetObject needed).
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [bucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['packages/*'] } },
    }));
    // Live routes call the coviewer runtime and screen questions with the guardrail.
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: [
        cdk.Stack.of(this).formatArn({ service: 'bedrock-agentcore', resource: 'runtime', resourceName: '*' }),
      ],
    }));
    apiFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:ApplyGuardrail'],
      resources: [cdk.Stack.of(this).formatArn({ service: 'bedrock', resource: 'guardrail', resourceName: '*' })],
    }));

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      defaultIntegration: new integrations.HttpLambdaIntegration('ApiIntegration', apiFn),
    });
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigw.CfnStage;
    defaultStage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };

    const linkRewrite = new cloudfront.Function(this, 'LinkRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    request.uri = '/link/index.html';
  }
  return request;
}`),
    });

    const apiOrigin = new origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint)));
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/v1/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        '/link/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functionAssociations: [{
            function: linkRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
    });

    new ssm.StringParameter(this, 'DomainParam', {
      parameterName: DOMAIN_PARAM,
      stringValue: distribution.distributionDomainName,
    });

    // Names the pipeline stack imports (parameter lookups at deploy time; no CloudFormation exports).
    new ssm.StringParameter(this, 'BucketParam', { parameterName: '/studiox/bucket', stringValue: bucket.bucketName });
    new ssm.StringParameter(this, 'TableParam', { parameterName: '/studiox/table', stringValue: table.tableName });
    // Live switch: 'on' | 'off'. Change with `aws ssm put-parameter --overwrite` (CloudFormation leaves it alone).
    new ssm.StringParameter(this, 'LiveParam', { parameterName: LIVE_PARAM, stringValue: 'off' });
    new ssm.StringParameter(this, 'AccessCodeParam', {
      parameterName: ACCESS_PARAM,
      stringValue: 'unset', // live routes answer 503 ACCESS_CODE_UNSET until the owner sets a real code
    });

    const linkDir = path.join(__dirname, '../../../webapp/link');
    if (fs.existsSync(linkDir)) {
      new s3deploy.BucketDeployment(this, 'LinkApp', {
        sources: [s3deploy.Source.asset(linkDir)],
        destinationBucket: bucket,
        destinationKeyPrefix: 'link',
        distribution,
        distributionPaths: ['/link/*'],
      });
    }

    new cdk.CfnOutput(this, 'CloudFrontDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
