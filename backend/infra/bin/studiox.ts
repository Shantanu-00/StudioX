import * as cdk from 'aws-cdk-lib';
import { StudioXCoreStack } from '../lib/core-stack';
import { StudioXPipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();
// No context lookups: synth must work without AWS calls.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };
new StudioXCoreStack(app, 'StudioXCore', { env });
new StudioXPipelineStack(app, 'StudioXPipeline', { env });
