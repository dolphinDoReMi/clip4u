import type { IdentityProfile, IdentityService, RelationshipProfile } from '@delegate-ai/adapter-types'

const defaultIdentity = (userId: string): IdentityProfile => ({
  userId,
  displayName: 'Mira User',
  tone: 'warm, direct, concise',
  styleGuide: ['keep commitments bounded', 'avoid overpromising', 'sound human'],
  hardBoundaries: ['no financial commitments', 'no legal commitments', 'no irreversible promises'],
})

const defaultRelationship = (userId: string, contactId: string): RelationshipProfile => ({
  userId,
  contactId,
  role: 'unknown',
  tone: 'warm',
  riskLevel: 'medium',
  notes: [],
})

export class InMemoryIdentityService implements IdentityService {
  private readonly identities = new Map<string, IdentityProfile>()
  private readonly relationships = new Map<string, RelationshipProfile>()

  async getIdentity(userId: string): Promise<IdentityProfile> {
    return this.identities.get(userId) ?? defaultIdentity(userId)
  }

  async getRelationship(userId: string, contactId: string): Promise<RelationshipProfile> {
    return this.relationships.get(`${userId}:${contactId}`) ?? defaultRelationship(userId, contactId)
  }

  async upsertIdentity(profile: IdentityProfile): Promise<void> {
    this.identities.set(profile.userId, profile)
  }

  async upsertRelationship(profile: RelationshipProfile): Promise<void> {
    this.relationships.set(`${profile.userId}:${profile.contactId}`, profile)
  }
}
