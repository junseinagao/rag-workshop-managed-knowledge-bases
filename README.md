# Amazon Bedrock Managed Knowledge Base + AgentCore Runtime 研修

Amazon Bedrock **Managed Knowledge Base**(2026年6月GAの新サービス)を使ったRAGの構築と、Amazon Bedrock **AgentCore Runtime**(+ Code Interpreter)を使ったエージェント開発を、TypeScript(`tsx`実行)のハンズオンで学べる社内研修教材。

題材として、任意のWebサイトの詳細ページ群をWeb Crawlerで取り込み、そこから数値データ(価格、実績値など)を検索してグラフを作成するエージェントを構築する。
クロール対象サイトはハンズオン実施者自身が `01_knowledge_base/README_INTERNAL.md` の「Seed URLs」セクションで指定する(詳細は [01のREADME](01_knowledge_base/README.md) 参照)。

> **題材選びについて:** クロール対象ページの多くが具体的な数値に乏しい内容の場合、共通モデルの実数値(価格、実績値など)を持つページ群を選ぶと、複数ドキュメントを横断した比較チャートのデモに向く。
> 02のデフォルトのデモクエリは、そうしたページ群を前提にする想定である(詳細は [01のREADME](01_knowledge_base/README.md) 参照)。

> **本リポジトリの位置づけについて:** このリポジトリの作成過程ではAWSリソースの作成や実行は一切行っていない(IAMロール作成、Knowledge Base作成、Ingestion実行、Runtimeデプロイ、グラフ生成のいずれも未実施)。
> すべてのスクリプトは受講者ご自身のAWSアカウントと環境で実行することを前提に書かれている。

## What You'll Learn

### Foundation (01)

- **01. Knowledge Base**:Amazon Bedrock Managed Knowledge Baseの作成、Web Crawlerデータソースの設定(sitemap起点 + URLフィルタ)、Ingestion実行、Retrieve/RetrieveAndGenerateによる検索

### Extension (02-03)

- **02. Chart Agent**:Strands Agents SDKによるエージェント構築、Knowledge Base検索ツールの実装、AgentCore Code Interpreterでのグラフ生成
- **03. Runtime**:AgentCore RuntimeのHTTP契約(`BedrockAgentCoreApp`)、コンテナ化(`--platform linux/arm64`)、IAM実行ロールの設計、デプロイ手順

## Learning Philosophy

- **Runnable Code First**:疑似コードではなく、実際に動くAWS SDK呼び出しで説明する
- **Practical Implementation**:実在のWebサイトを題材に、現実的なユースケースで学ぶ
- **Progressive Learning**:Knowledge Base単体からエージェント統合、本番デプロイへと段階的に理解を積み上げる
- **Safe by Default**:各モジュールに `clean-resources.ts` を用意し、不要なリソースをすぐに削除できるようにする

## Hands-On Learning Path

1. **[01. Knowledge Base](01_knowledge_base/README.md)**:Managed Knowledge Base + Web Crawlerの構築
   - 対象サイトの詳細ページ群を取り込む
   - Retrieve / RetrieveAndGenerate で検索する
   - 所要時間目安: ~20分 | 難易度: Beginner
2. **[02. Chart Agent](02_chart_agent/README.md)**:Knowledge Base検索 + Code Interpreterによるグラフ生成
   - Strands Agentに `query_knowledge_base` / `generate_chart` の2つのtoolを持たせる
   - ローカルでmatplotlibグラフを生成する
   - 所要時間目安: ~20分 | 難易度: Intermediate
3. **[03. Runtime](03_runtime/README.md)**:AgentCore Runtimeへのデプロイ
   - `BedrockAgentCoreApp` でHTTP契約を実装する
   - Dockerイメージのビルド、ECR push、Runtime作成の手順を体験する
   - 所要時間目安: ~20分 | 難易度: Intermediate

## Prerequisites

- Node.js 20以上
- AWS CLI **2.32.0以上**(`aws login` を使うために必要。`aws --version` で確認)
- 対象リージョン(既定: `ap-northeast-1`)でAmazon Bedrockのモデルアクセスが有効化されていること
- Amazon Bedrock Managed Knowledge Baseが利用可能なリージョンであること(執筆時点でTokyoを含む主要リージョンが対応)
- (03のみ)Docker Desktop等、`--platform linux/arm64` のクロスビルドに対応したコンテナビルド環境

## Quick Setup

### 1. AWSにサインインする

本リポジトリのスクリプトはすべて `aws login` で取得した認証情報を前提にしている。
`aws login` はブラウザ経由でサインインし、15分ごとに自動更新される短期認証情報(最大12時間有効)を発行する。
長期のアクセスキーをディスクに保存する `aws configure` より安全なため、こちらを既定の方法とする。

```bash
aws login
```

ブラウザが開かない環境(リモートサーバー等)では `aws login --remote` を使うと、別デバイスで認証するためのURLとコードが表示される。
複数アカウントを使い分ける場合は `aws login --profile <profile名>` でプロファイルを指定する(この場合、以降のコマンドにも `--profile <profile名>` を付けるか `AWS_PROFILE` 環境変数を設定すること)。

すでに組織のIAM Identity Center(SSO)を使っている場合は、既存の `aws sso login` ワークフローをそのまま使ってよい。

### 2. 認証情報を確認する

```bash
aws sts get-caller-identity
```

AccountとArnが期待どおりであることを確認する。
AWS SDK for JavaScript(v3)は `~/.aws/` 配下の認証情報を自動的に読み込むため、`aws login` 後は追加設定なしでスクリプトからそのまま利用できる。

### 3. セットアップする

```bash
git clone <このリポジトリ>
cd ai-poc-knowledge-bases
npm install

# 型チェック(AWSへの通信は発生しない)
npm run typecheck

# Module 01から順に進める
npx tsx 01_knowledge_base/create-iam-role.ts
```

各モジュールの詳しい手順は、それぞれのREADME(`01_knowledge_base/README.md` など)を参照。

## tsx について

`@strands-agents/sdk` / `bedrock-agentcore` がESM専用パッケージのため、`package.json` に `"type": "module"` を設定し、`npx tsx <file>.ts` でそのままESMとして実行できるようにしている。
`tsx` はESMのモジュール解決をネイティブに扱うため、`ts-node` で必要になる追加設定(`"ts-node": {"esm": true}` 等)なしで動く。

## Key Features

- Managed Knowledge Baseによる「ベクトルストア構築不要」なRAGサンプル
- Web Crawlerの `seedUrls`(最大10件)制約を `siteMapUrls` + `inclusionPatterns` で回避する実践パターン
- AgentCore Code InterpreterでのPythonサンドボックス実行 + 画像(グラフ)の受け渡し方法
- AgentCore RuntimeのHTTP契約実装とコンテナデプロイの一連の流れ

## Resource Cleanup

課金を止めるため、作成した順とは逆順(03 → 01)で削除する。

```bash
# 03: Agent Runtime / ECR / IAMロール
npx tsx 03_runtime/clean-resources.ts --runtime-id <agentRuntimeId>

# 01: データソース / Knowledge Base / IAMロール
npx tsx 01_knowledge_base/clean-resources.ts
```

## References

- [Amazon Bedrock Managed Knowledge Base 発表記事](https://aws.amazon.com/blogs/aws/introducing-amazon-bedrock-managed-knowledge-base-for-faster-more-accurate-enterprise-ai-applications/)
- [Amazon Bedrock Knowledge Bases Developer Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [Amazon Bedrock AgentCore Developer Guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [Strands Agents](https://strandsagents.com/)

## Security

- 各IAMロールの信頼ポリシーは `aws:SourceAccount` / `aws:SourceArn` 条件でconfused deputy攻撃を防止している
- `bedrock:Retrieve` 権限はKnowledge Base ARNに、Code Interpreter権限はAgentCoreリソースにそれぞれスコープしている
- 対象サイトが認証不要の公開サイトであることを前提にしており、認証情報をSecrets Managerに保存する処理は含めていない(認証が必要なサイトを対象にする場合は各モジュールREADMEのコメントを参照)
