/**
 * Chart Agent — Amazon Bedrock Managed Knowledge Base + AgentCore Code Interpreter
 *
 * Demonstrates:
 * 1. Retrieve APIでManaged Knowledge Base(01_knowledge_base)から数値データを検索するtool
 * 2. AgentCore Code Interpreterでmatplotlibグラフを安全に生成するtool
 * 3. Strands Agents TypeScript SDKによるオーケストレーション
 *
 * 01_code_interpreter/cost-estimator-agent (参考リポジトリ) と同じ構成パターンを踏襲している:
 * ローカルで動くAgentクラスとして実装し、03_runtime でAgentCore Runtimeにラップしてデプロイする。
 */

import { Agent, tool, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'
import { CodeInterpreter } from 'bedrock-agentcore/code-interpreter'
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime'
import { getAwsRegion } from '../../shared/aws-helpers.js'
import { loadConfig } from '../../shared/config-store.js'
import { KB_CONFIG_PATH } from '../../shared/paths.js'
import type { KnowledgeBaseConfig } from '../../shared/types.js'
import { SYSTEM_PROMPT, CHART_REQUEST_PROMPT, DEFAULT_MODEL } from './config.js'

const CHART_MARKER = 'CHART_BASE64_PNG:'

export class ChartAgent {
  private region: string
  private codeInterpreter: CodeInterpreter | null = null
  private knowledgeBaseId: string | undefined
  /** 直近に生成されたグラフのbase64 PNG(呼び出し側がファイル保存等に使う) */
  public lastChartBase64: string | null = null

  constructor(options?: { region?: string; knowledgeBaseId?: string }) {
    this.region = options?.region ?? getAwsRegion()
    // 優先順位: 明示的な指定 > 環境変数(AgentCore Runtimeデプロイ時) > ローカル設定ファイル(ローカル開発時)
    this.knowledgeBaseId =
      options?.knowledgeBaseId ??
      process.env.KNOWLEDGE_BASE_ID ??
      loadConfig<KnowledgeBaseConfig>(KB_CONFIG_PATH).knowledgeBaseId
    console.log(`ChartAgentを初期化しています (region: ${this.region})`)
  }

  private async setupCodeInterpreter(): Promise<void> {
    console.log('AgentCore Code Interpreterをセットアップしています...')
    this.codeInterpreter = new CodeInterpreter({ region: this.region })
    await this.codeInterpreter.startSession()
    console.log('Code Interpreterセッションを開始しました')
  }

  /** Knowledge Base検索ツール */
  private createQueryKnowledgeBaseTool() {
    const knowledgeBaseId = this.knowledgeBaseId
    const client = new BedrockAgentRuntimeClient({ region: this.region })

    return tool({
      name: 'query_knowledge_base',
      description:
        '対象サイトのカタログKnowledge Baseを検索し、関連する詳細ページのテキストチャンクを返す。' +
        '価格帯や実績値などの数値データを探す際に使う。',
      inputSchema: z.object({
        query: z.string().describe('検索クエリ(日本語可)'),
      }),
      callback: async (input) => {
        if (!knowledgeBaseId) {
          return 'Knowledge Baseが未設定です。01_knowledge_base のセットアップを先に実行してください。'
        }
        try {
          const resp = await client.send(
            new RetrieveCommand({
              knowledgeBaseId,
              retrievalQuery: { text: input.query },
            }),
          )
          const chunks = (resp.retrievalResults ?? []).map((r) => {
            const url = r.location?.webLocation?.url ?? 'unknown'
            return `[${url}]\n${r.content?.text ?? ''}`
          })
          return chunks.length > 0 ? chunks.join('\n\n---\n\n') : '関連する情報が見つかりませんでした。'
        } catch (e) {
          return `Knowledge Base検索に失敗しました: ${e}`
        }
      },
    })
  }

  /** グラフ生成ツール(Code Interpreter上でmatplotlibを実行) */
  private createGenerateChartTool() {
    const agentSelf = this
    return tool({
      name: 'generate_chart',
      description:
        'matplotlibのPythonコードをAgentCore Code Interpreterのサンドボックスで実行し、グラフ画像(PNG)を生成する。' +
        'コードは図をbase64エンコードし "CHART_BASE64_PNG:" プレフィックス付きで1行printすること。',
      inputSchema: z.object({
        code: z.string().describe('matplotlibでグラフを生成するPythonコード'),
        description: z.string().optional().describe('何のグラフかの説明'),
      }),
      callback: async (input) => {
        const ci = agentSelf.codeInterpreter
        if (!ci) return 'Code Interpreterが初期化されていません'
        try {
          console.log(`グラフ生成コードを実行しています: ${input.description ?? ''}`)
          const resultText = await ci.executeCode({ code: input.code, language: 'python' })

          const markerLine = (resultText ?? '')
            .split('\n')
            .find((line) => line.startsWith(CHART_MARKER))

          if (markerLine) {
            agentSelf.lastChartBase64 = markerLine.slice(CHART_MARKER.length).trim()
            return 'グラフを生成しました(PNG画像をbase64として保持しています)。'
          }

          console.warn('CHART_BASE64_PNG マーカーが出力に見つかりませんでした')
          return `グラフ生成コードは実行されましたが、画像データを検出できませんでした。出力: ${resultText}`
        } catch (e) {
          return `グラフ生成に失敗しました: ${e}`
        }
      },
    })
  }

  /** ユーザーの依頼に応じてKB検索 + グラフ生成を行う(非ストリーミング) */
  async handleRequest(userRequest: string): Promise<{ text: string; chartBase64: string | null }> {
    this.lastChartBase64 = null
    try {
      await this.setupCodeInterpreter()

      const agent = new Agent({
        model: new BedrockModel({ modelId: DEFAULT_MODEL, region: this.region }),
        tools: [this.createQueryKnowledgeBaseTool(), this.createGenerateChartTool()],
        systemPrompt: SYSTEM_PROMPT,
      })

      const prompt = CHART_REQUEST_PROMPT.replace('{user_request}', userRequest)
      const result = await agent.invoke(prompt)

      const textParts: string[] = []
      for (const block of result.lastMessage?.content ?? []) {
        if ('text' in block && typeof block.text === 'string') textParts.push(block.text)
      }

      return { text: textParts.join('') || '応答がありませんでした。', chartBase64: this.lastChartBase64 }
    } finally {
      await this.cleanup()
    }
  }

  async cleanup(): Promise<void> {
    if (this.codeInterpreter) {
      try {
        await this.codeInterpreter.stopSession()
      } catch (e) {
        console.warn(`Code Interpreterの停止中にエラー: ${e}`)
      } finally {
        this.codeInterpreter = null
      }
    }
  }
}
