import type { ApprovalRecord, ApprovalStore } from '@delegate-ai/adapter-types'

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly approvals = new Map<string, ApprovalRecord>()

  async createApproval(record: Omit<ApprovalRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<ApprovalRecord> {
    const approval: ApprovalRecord = {
      ...record,
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.approvals.set(approval.id, approval)
    return approval
  }

  async listApprovals(): Promise<ApprovalRecord[]> {
    return [...this.approvals.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getApproval(id: string): Promise<ApprovalRecord | undefined> {
    return this.approvals.get(id)
  }

  async approve(id: string): Promise<ApprovalRecord | undefined> {
    return this.updateStatus(id, 'approved')
  }

  async reject(id: string): Promise<ApprovalRecord | undefined> {
    return this.updateStatus(id, 'rejected')
  }

  async edit(id: string, editedText: string): Promise<ApprovalRecord | undefined> {
    const current = this.approvals.get(id)
    if (!current) {
      return undefined
    }
    const updated: ApprovalRecord = {
      ...current,
      status: 'edited',
      editedText,
      updatedAt: Date.now(),
    }
    this.approvals.set(id, updated)
    return updated
  }

  private async updateStatus(id: string, status: ApprovalRecord['status']): Promise<ApprovalRecord | undefined> {
    const current = this.approvals.get(id)
    if (!current) {
      return undefined
    }
    const updated: ApprovalRecord = {
      ...current,
      status,
      updatedAt: Date.now(),
    }
    this.approvals.set(id, updated)
    return updated
  }
}
