/**
 * AWS Helper Utilities
 *
 * Common AWS operations shared across the training modules:
 * - Region resolution
 * - Account ID retrieval
 * - Sleep helper for polling loops
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'

/**
 * Bedrock生成モデル(推論プロファイル)。
 * 日本リージョン内でデータを完結させる jp. プレフィックスの推論プロファイルを既定値とする。
 */
export const DEFAULT_MODEL_ID = 'jp.anthropic.claude-sonnet-4-6'

/** Resolve AWS region following SDK resolution order */
export function getAwsRegion(): string {
  return process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'ap-northeast-1'
}

/** Get current AWS account ID via STS */
export async function getAwsAccountId(region?: string): Promise<string> {
  const sts = new STSClient({ region: region ?? getAwsRegion() })
  const identity = await sts.send(new GetCallerIdentityCommand({}))
  if (!identity.Account) throw new Error('GetCallerIdentity did not return an account ID')
  return identity.Account
}

/** Get current AWS caller identity ARN */
export async function getCallerArn(region?: string): Promise<string> {
  const sts = new STSClient({ region: region ?? getAwsRegion() })
  const identity = await sts.send(new GetCallerIdentityCommand({}))
  if (!identity.Arn) throw new Error('GetCallerIdentity did not return an ARN')
  return identity.Arn
}

/** Sleep helper for polling loops */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
