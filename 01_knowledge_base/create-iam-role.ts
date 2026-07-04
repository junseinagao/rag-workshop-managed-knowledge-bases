#!/usr/bin/env npx tsx
/**
 * Amazon Bedrock Managed Knowledge Base - IAM Service Role Setup
 *
 * Managed Knowledge Base はベクトルストアの管理こそ不要だが、KBの作成・データソースの
 * 同期を代行するためのIAMサービスロールは引き続き必要 (CreateKnowledgeBase の roleArn は必須)。
 * 参考: https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-permissions.html
 *
 * Usage:
 *   npx tsx 01_knowledge_base/create-iam-role.ts
 */

import { IAMClient, CreateRoleCommand, PutRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam'
import { getAwsRegion, getAwsAccountId, sleep } from '../shared/aws-helpers.js'
import { saveConfig } from '../shared/config-store.js'
import { KB_CONFIG_PATH } from '../shared/paths.js'

const ROLE_NAME = 'AmazonBedrockExecutionRoleForManagedKB-sample-catalog'

async function createKnowledgeBaseRole(): Promise<{ roleName: string; roleArn: string }> {
  const region = getAwsRegion()
  const accountId = await getAwsAccountId(region)
  const iam = new IAMClient({ region })

  // 1. 信頼ポリシー: bedrock.amazonaws.com のみがこのロールをAssumeできる
  //    (confused deputy対策として aws:SourceAccount / aws:SourceArn を条件に付与)
  const trustPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'bedrock.amazonaws.com' },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: { 'aws:SourceAccount': accountId },
          ArnLike: { 'aws:SourceArn': `arn:aws:bedrock:${region}:${accountId}:knowledge-base/*` },
        },
      },
    ],
  }

  // 2. Bedrock基盤モデルへのアクセス許可
  //    embeddingModelType が MANAGED (今回のデフォルト) の場合、埋め込みモデル自体はAWS管理のため
  //    このInvokeModel権限は必須ではないが、CUSTOMに切り替える可能性やドキュメントの推奨構成に
  //    合わせて付与しておく。生成モデル(RetrieveAndGenerate用)の呼び出し権限も含む。
  const modelAccessPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'ListBedrockModels',
        Effect: 'Allow',
        Action: ['bedrock:ListFoundationModels', 'bedrock:ListCustomModels'],
        Resource: '*',
      },
      {
        Sid: 'InvokeBedrockModels',
        Effect: 'Allow',
        Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        Resource: '*',
      },
    ],
  }

  // 3. データソース(Web Crawler)へのアクセス許可
  //    対象サイトが認証不要(NO_AUTH)の公開サイトの場合、Secrets Managerへの
  //    アクセス権限は不要。認証が必要なサイトをクロールする場合は
  //    secretsmanager:GetSecretValue を対象シークレットARNに対して追加する。

  let roleArn: string
  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }))
    roleArn = existing.Role!.Arn!
    console.log(`IAMロールは既に存在します: ${ROLE_NAME}`)
  } catch {
    const created = await iam.send(
      new CreateRoleCommand({
        RoleName: ROLE_NAME,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
        Description: 'Amazon Bedrock Managed Knowledge Base (sample catalog) service role',
      }),
    )
    roleArn = created.Role!.Arn!
    console.log(`IAMロールを作成しました: ${ROLE_NAME}`)
  }

  await iam.send(
    new PutRolePolicyCommand({
      RoleName: ROLE_NAME,
      PolicyName: `${ROLE_NAME}-ModelAccess`,
      PolicyDocument: JSON.stringify(modelAccessPolicy),
    }),
  )
  console.log(`モデルアクセスポリシーをアタッチしました: ${ROLE_NAME}`)

  return { roleName: ROLE_NAME, roleArn }
}

async function main() {
  const { roleName, roleArn } = await createKnowledgeBaseRole()

  // IAMロールの伝播待ち(すぐにCreateKnowledgeBaseで使うとAssumeRole失敗することがあるため)
  console.log('IAMロールの伝播を待機しています (10秒)...')
  await sleep(10_000)

  saveConfig(KB_CONFIG_PATH, { roleName, roleArn })
  console.log(`\n完了。ロールARN: ${roleArn}`)
  console.log(`設定を保存しました: ${KB_CONFIG_PATH}`)
}

main().catch((e) => {
  console.error('IAMロール作成に失敗しました:', e)
  process.exit(1)
})
