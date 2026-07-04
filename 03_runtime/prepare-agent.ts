#!/usr/bin/env npx tsx
/**
 * AgentCore Runtime - エージェント準備ツール
 *
 * Chart AgentをAmazon Bedrock AgentCore Runtimeにデプロイするための
 * IAM実行ロールを作成し、docker build / ECR push / create-agent-runtime の
 * コマンドを表示する。
 *
 * このスクリプトはIAMロールの作成のみを実際に実行する。docker build/push や
 * create-agent-runtime は表示するだけで自動実行しない(研修受講者が内容を
 * 理解しながら自分の判断で実行するため)。
 *
 * Usage:
 *   npx tsx 03_runtime/prepare-agent.ts
 */

import { Command } from 'commander'
import { IAMClient, CreateRoleCommand, PutRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam'
import { getAwsRegion, getAwsAccountId } from '../shared/aws-helpers.js'
import { loadConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'
import type { KnowledgeBaseConfig } from '../shared/types.js'

const AGENT_NAME = 'chart-agent'
const RUNTIME_NAME = AGENT_NAME.replace(/-/g, '_') // AgentCore制約: [a-zA-Z][a-zA-Z0-9_]{0,47}
const DEPLOYMENT_DIR = './03_runtime/deployment'

async function createAgentCoreRole(region: string): Promise<{ roleName: string; roleArn: string }> {
  const roleName = `AgentCoreRole-${AGENT_NAME}`
  const accountId = await getAwsAccountId(region)
  const iam = new IAMClient({ region })

  const kbConfig = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)
  const knowledgeBaseArn = kbConfig.knowledgeBaseArn

  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: { 'aws:SourceAccount': accountId },
          ArnLike: { 'aws:SourceArn': `arn:aws:bedrock-agentcore:${region}:${accountId}:*` },
        },
      },
    ],
  }

  const statements: Record<string, unknown>[] = [
    {
      Sid: 'BedrockModelInvoke',
      Effect: 'Allow',
      Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      Resource: '*',
    },
    {
      Sid: 'ECRImageAccess',
      Effect: 'Allow',
      Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
      Resource: [`arn:aws:ecr:${region}:${accountId}:repository/*`],
    },
    {
      Sid: 'ECRTokenAccess',
      Effect: 'Allow',
      Action: ['ecr:GetAuthorizationToken'],
      Resource: '*',
    },
    {
      Sid: 'LogsGroups',
      Effect: 'Allow',
      Action: ['logs:DescribeLogStreams', 'logs:CreateLogGroup', 'logs:DescribeLogGroups'],
      Resource: [`arn:aws:logs:${region}:${accountId}:log-group:*`],
    },
    {
      Sid: 'LogsStreams',
      Effect: 'Allow',
      Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
    },
    {
      Sid: 'XRayTracing',
      Effect: 'Allow',
      Action: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
      Resource: '*',
    },
    {
      Sid: 'CloudWatchMetrics',
      Effect: 'Allow',
      Action: 'cloudwatch:PutMetricData',
      Resource: '*',
      Condition: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
    },
    {
      Sid: 'CodeInterpreterAccess',
      Effect: 'Allow',
      Action: [
        'bedrock-agentcore:CreateCodeInterpreter',
        'bedrock-agentcore:StartCodeInterpreterSession',
        'bedrock-agentcore:InvokeCodeInterpreter',
        'bedrock-agentcore:StopCodeInterpreterSession',
        'bedrock-agentcore:DeleteCodeInterpreter',
        'bedrock-agentcore:ListCodeInterpreters',
        'bedrock-agentcore:GetCodeInterpreter',
        'bedrock-agentcore:GetCodeInterpreterSession',
        'bedrock-agentcore:ListCodeInterpreterSessions',
      ],
      Resource: 'arn:aws:bedrock-agentcore:*:*:*',
    },
  ]

  if (knowledgeBaseArn) {
    statements.push({
      Sid: 'KnowledgeBaseRetrieve',
      Effect: 'Allow',
      Action: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
      Resource: knowledgeBaseArn,
    })
  } else {
    console.warn(
      `警告: ${KB_CONFIG_PATH} に knowledgeBaseArn が見つかりません。01_knowledge_base のセットアップを先に完了してください。` +
        'bedrock:Retrieve の権限は付与されません。',
    )
  }

  const executionPolicy = { Version: '2012-10-17', Statement: statements }

  let roleArn: string
  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: roleName }))
    roleArn = existing.Role!.Arn!
    console.log(`IAMロールは既に存在します: ${roleName}`)
  } catch {
    const created = await iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
        Description: `AgentCore execution role for ${AGENT_NAME}`,
      }),
    )
    roleArn = created.Role!.Arn!
    console.log(`IAMロールを作成しました: ${roleName}`)
  }

  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: `${roleName}-ExecutionPolicy`,
      PolicyDocument: JSON.stringify(executionPolicy),
    }),
  )
  console.log(`実行ポリシーをアタッチしました: ${roleName}`)

  return { roleName, roleArn }
}

function buildDeployCommand(region: string, roleArn: string, knowledgeBaseId: string | undefined): string {
  return [
    '',
    '# 1. Dockerイメージをビルドする (AgentCore Runtimeはarm64必須):',
    `docker build --platform linux/arm64 -t ${AGENT_NAME} -f ${DEPLOYMENT_DIR}/Dockerfile .`,
    '',
    '# 2. ECRにpushする:',
    'ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)',
    `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.${region}.amazonaws.com`,
    `aws ecr create-repository --repository-name ${AGENT_NAME} --region ${region} 2>/dev/null || true`,
    `docker tag ${AGENT_NAME}:latest $ACCOUNT_ID.dkr.ecr.${region}.amazonaws.com/${AGENT_NAME}:latest`,
    `docker push $ACCOUNT_ID.dkr.ecr.${region}.amazonaws.com/${AGENT_NAME}:latest`,
    '',
    '# 3. Agent Runtimeを作成する:',
    'aws bedrock-agentcore-control create-agent-runtime \\',
    `  --agent-runtime-name ${RUNTIME_NAME} \\`,
    `  --role-arn ${roleArn} \\`,
    `  --agent-runtime-artifact '{"containerConfiguration":{"containerUri":"'$ACCOUNT_ID'.dkr.ecr.${region}.amazonaws.com/${AGENT_NAME}:latest"}}' \\`,
    `  --network-configuration '{"networkMode":"PUBLIC"}' \\`,
    `  --environment-variables '{"KNOWLEDGE_BASE_ID":"${knowledgeBaseId ?? '<01で作成したKB ID>'}"}' \\`,
    `  --region ${region}`,
    '',
    '# 4. 呼び出す:',
    `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <上記コマンドが返すID> --region ${region}`,
  ].join('\n')
}

async function main() {
  const program = new Command().option('--region <region>', 'AWSリージョン', getAwsRegion()).parse()
  const { region } = program.opts<{ region: string }>()

  const { roleArn } = await createAgentCoreRole(region)
  // コンテナ内には .kb-config.json が存在しないため、KB IDは環境変数として渡す(deployment/index.ts参照)
  const { knowledgeBaseId } = loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH)
  const deployCommand = buildDeployCommand(region, roleArn, knowledgeBaseId)

  console.log('\n--- エージェント準備が完了しました ---')
  console.log(`Agent Name: ${AGENT_NAME}`)
  console.log(`Runtime Name: ${RUNTIME_NAME}`)
  console.log(`Region: ${region}`)
  console.log(`Role ARN: ${roleArn}`)
  console.log('\n次のステップ(このスクリプトは実行しません。内容を確認しながら手動で実行してください):')
  console.log(deployCommand)
}

main().catch((e) => {
  console.error('\nエラー:', e)
  process.exit(1)
})
