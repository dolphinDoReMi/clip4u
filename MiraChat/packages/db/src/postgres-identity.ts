import type { IdentityProfile, IdentityService, RelationshipProfile } from '@delegate-ai/adapter-types'
import type { Pool } from 'pg'

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

export class PostgresIdentityService implements IdentityService {
  constructor(private readonly pool: Pool) {}

  async getIdentity(userId: string): Promise<IdentityProfile> {
    const base = defaultIdentity(userId)
    const profileRow = await this.pool.query<{
      display_name: string
      tone: string
      style_guide: string[] | null
    }>(
      `SELECT display_name, tone, style_guide FROM identity_profiles WHERE user_id = $1`,
      [userId],
    )
    const { rows } = await this.pool.query<{ constraint_text: string }>(
      `SELECT constraint_text FROM hard_constraints WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    )
    const fromDb = rows.map((r: { constraint_text: string }) => r.constraint_text).filter(Boolean)
    const profile = profileRow.rows[0]
    return {
      ...base,
      displayName: profile?.display_name?.trim() || base.displayName,
      tone: profile?.tone?.trim() || base.tone,
      styleGuide:
        profile?.style_guide && profile.style_guide.length > 0
          ? profile.style_guide.filter(Boolean)
          : base.styleGuide,
      hardBoundaries: fromDb.length > 0 ? fromDb : base.hardBoundaries,
    }
  }

  async getRelationship(userId: string, contactId: string): Promise<RelationshipProfile> {
    const { rows } = await this.pool.query<{
      relationship_type: string
      tone_profile: string
      risk_level: string
      notes: string[] | null
    }>(
      `SELECT relationship_type, tone_profile, risk_level, notes FROM relationship_graph WHERE user_id = $1 AND contact_id = $2`,
      [userId, contactId],
    )
    const row = rows[0]
    if (!row) {
      return defaultRelationship(userId, contactId)
    }
    return {
      userId,
      contactId,
      role: row.relationship_type,
      tone: row.tone_profile,
      riskLevel: row.risk_level as RelationshipProfile['riskLevel'],
      notes: row.notes ?? [],
    }
  }

  async upsertIdentity(profile: IdentityProfile): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO identity_profiles (user_id, display_name, tone, style_guide)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        tone = EXCLUDED.tone,
        style_guide = EXCLUDED.style_guide,
        updated_at = now()
      `,
      [
        profile.userId,
        profile.displayName,
        profile.tone,
        profile.styleGuide,
      ],
    )
    await this.pool.query(`DELETE FROM hard_constraints WHERE user_id = $1`, [profile.userId])
    for (const boundary of profile.hardBoundaries) {
      await this.pool.query(
        `INSERT INTO hard_constraints (user_id, constraint_text) VALUES ($1, $2)`,
        [profile.userId, boundary],
      )
    }
  }

  async upsertRelationship(profile: RelationshipProfile): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO relationship_graph (user_id, contact_id, relationship_type, tone_profile, risk_level, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, contact_id) DO UPDATE SET
        relationship_type = EXCLUDED.relationship_type,
        tone_profile = EXCLUDED.tone_profile,
        risk_level = EXCLUDED.risk_level,
        notes = EXCLUDED.notes
      `,
      [
        profile.userId,
        profile.contactId,
        profile.role,
        profile.tone,
        profile.riskLevel,
        profile.notes,
      ],
    )
  }
}
