/**
 * Shared TypeScript interfaces for the training modules
 */

/** Knowledge Base config file (01_knowledge_base/.kb-config.json) */
export interface KnowledgeBaseConfig {
  roleName?: string
  roleArn?: string
  knowledgeBaseId?: string
  knowledgeBaseArn?: string
  dataSourceId?: string
  dataSourceName?: string
  lastIngestionJobId?: string
  [key: string]: unknown
}
