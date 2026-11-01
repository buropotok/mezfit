import { liveQuery } from 'dexie';
import { isApprovedAssignedPair } from './assigned-programs';
import type { MezfitCloudDatabase } from './database';
import {
  FlexAttributesRepository, flexAttributeId, flexValueId,
  type FlexAttributeInput, type FlexResolvedValue,
} from './flex-attributes';
import { parseLocalDate, getTodayLocalDate } from '../../ui/date-picker/datePickerDate';

export type ClientIntakeSex = 'male' | 'female' | 'undisclosed';
export interface ClientIntake {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  telegramUsername: string;
  birthDate: string;
  sex: ClientIntakeSex;
  weightKg: number | null;
  updatedAt: string;
}
export type ClientIntakeDraft = Omit<ClientIntake, 'updatedAt'>;
export type ClientIntakeDefaults = Pick<ClientIntakeDraft, 'firstName' | 'lastName' | 'telegramUsername'>;
export interface IntakeRelationship { relationshipId: string; coachUserId: string }

const keys = {
  firstName: 'ClientIntake_FirstName',
  lastName: 'ClientIntake_LastName',
  email: 'ClientIntake_Email',
  phone: 'ClientIntake_Phone',
  telegramUsername: 'ClientIntake_Telegram',
  birthDate: 'ClientIntake_BirthDate',
  sex: 'ClientIntake_Sex',
  weightKg: 'ClientIntake_WeightKg',
  updatedAt: 'ClientIntake_UpdatedAt',
} as const;
const userIdPattern = /^tg:[1-9]\d*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9 ()\-]{7,25}$/;
const usernamePattern = /^\@?[A-Za-z0-9_]{5,32}$/;

export function initialClientIntake(defaults: ClientIntakeDefaults): ClientIntakeDraft {
  return { firstName: defaults.firstName, lastName: defaults.lastName,
    telegramUsername: defaults.telegramUsername.replace(/^@/, ''),
    email: '', phone: '', birthDate: '', sex: 'undisclosed', weightKg: null };
}

export function validateClientIntake(value: ClientIntakeDraft, today = getTodayLocalDate()): string | null {
  if (!value.firstName.trim() || value.firstName.trim().length > 100
    || value.lastName.trim().length > 100) return 'Проверьте имя и фамилию';
  if (value.email && (!emailPattern.test(value.email) || value.email.length > 254))
    return 'Проверьте адрес E-mail';
  if (value.phone && !phonePattern.test(value.phone)) return 'Проверьте номер телефона';
  if (value.telegramUsername && !usernamePattern.test(value.telegramUsername))
    return 'Проверьте Telegram username';
  const birth = parseLocalDate(value.birthDate);
  const current = parseLocalDate(today);
  if (!birth || !current || birth.year < 1900 || value.birthDate > today)
    return 'Укажите корректную дату рождения';
  if (!['male', 'female', 'undisclosed'].includes(value.sex)) return 'Проверьте поле «Пол»';
  if (value.weightKg !== null && (!Number.isFinite(value.weightKg) || value.weightKg < 15 || value.weightKg > 500))
    return 'Укажите вес от 15 до 500 кг';
  return null;
}

export function ageFromBirthDate(birthDate: string, today = getTodayLocalDate()): number | null {
  const birth = parseLocalDate(birthDate);
  const current = parseLocalDate(today);
  if (!birth || !current || birthDate > today) return null;
  const birthdayPassed = current.month > birth.month
    || (current.month === birth.month && current.day >= birth.day);
  return current.year - birth.year - (birthdayPassed ? 0 : 1);
}

const fields: ReadonlyArray<{ key: keyof ClientIntake; type: 'string' | 'number' }> = [
  { key: 'firstName', type: 'string' }, { key: 'lastName', type: 'string' },
  { key: 'email', type: 'string' }, { key: 'phone', type: 'string' },
  { key: 'telegramUsername', type: 'string' }, { key: 'birthDate', type: 'string' },
  { key: 'sex', type: 'string' }, { key: 'weightKg', type: 'number' },
  { key: 'updatedAt', type: 'string' },
];

function serialize(profile: ClientIntake): FlexAttributeInput[] {
  return fields.map(({ key, type }) => ({ key: keys[key], valueType: type, value: profile[key] }));
}

function deserialize(values: readonly FlexResolvedValue[]): ClientIntake | null {
  const entries = new Map(values.map(row => [row.key, row]));
  const text = (key: keyof ClientIntake): string | null => {
    const row = entries.get(keys[key]);
    return row?.valueType === 'string' && typeof row.value === 'string' ? row.value : null;
  };
  const updatedAt = text('updatedAt');
  const firstName = text('firstName');
  const birthDate = text('birthDate');
  const sex = text('sex');
  const weight = entries.get(keys.weightKg);
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt)) || firstName === null
    || birthDate === null || sex === null) return null;
  const profile: ClientIntake = {
    firstName, lastName: text('lastName') ?? '',
    email: text('email') ?? '', phone: text('phone') ?? '',
    telegramUsername: text('telegramUsername') ?? '',
    birthDate, sex: sex as ClientIntakeSex,
    weightKg: weight?.valueType === 'number' && typeof weight.value === 'number'
      ? weight.value : null, updatedAt,
  };
  return validateClientIntake(profile) ? null : profile;
}

/** Own private record is authoritative; relationship copies are explicitly coach-visible. */
export class ClientIntakeRepository {
  private readonly flexible: FlexAttributesRepository<MezfitCloudDatabase>;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    if (!userIdPattern.test(actorUserId)) throw new Error('INVALID_CLIENT_INTAKE_ACTOR');
    this.flexible = new FlexAttributesRepository(db, actorUserId);
  }

  private ownTarget() {
    return { entityType: 'user' as const, entityId: this.actorUserId, realmId: this.actorUserId };
  }

  async readOwn(): Promise<ClientIntake | null> {
    return deserialize(await this.flexible.getValues(this.ownTarget()));
  }

  observeOwn(onChange: (profile: ClientIntake | null) => void, onError: (error: unknown) => void) {
    return liveQuery(() => this.readOwn()).subscribe({ next: onChange, error: onError });
  }

  async saveOwn(draft: ClientIntakeDraft): Promise<ClientIntake> {
    const normalized: ClientIntakeDraft = {
      firstName: draft.firstName.trim(), lastName: draft.lastName.trim(),
      email: draft.email.trim().toLowerCase(), phone: draft.phone.trim(),
      telegramUsername: draft.telegramUsername.trim().replace(/^@/, ''),
      birthDate: draft.birthDate, sex: draft.sex, weightKg: draft.weightKg,
    };
    const error = validateClientIntake(normalized);
    if (error) throw new Error(error);
    const profile: ClientIntake = { ...normalized, updatedAt: new Date().toISOString() };
    await this.flexible.setValues(this.ownTarget(), serialize(profile));
    return profile;
  }

  private async approvedRelationship(realmId: string, coachUserId: string, clientUserId: string) {
    if (!userIdPattern.test(coachUserId) || !userIdPattern.test(clientUserId)) {
      throw new Error('CLIENT_INTAKE_FORBIDDEN');
    }
    const [realm, members] = await Promise.all([
      this.db.realms.get(realmId),
      this.db.members.where('realmId').equals(realmId).toArray(),
    ]);
    if (!await isApprovedAssignedPair(realm, members, coachUserId, clientUserId)) {
      throw new Error('CLIENT_INTAKE_FORBIDDEN');
    }
  }

  async readForCoach(realmId: string, clientUserId: string): Promise<ClientIntake | null> {
    return this.db.transaction('r', this.db.realms, this.db.members,
      this.db.flexAttributes, this.db.flexValues, async () => {
        await this.approvedRelationship(realmId, this.actorUserId, clientUserId);
        const rows = await this.db.flexValues.where('[realmId+entityType+entityId]')
          .equals([realmId, 'user', clientUserId]).toArray();
        const values: FlexResolvedValue[] = [];
        for (const field of fields) {
          const attributeId = flexAttributeId(realmId, keys[field.key]);
          const attribute = await this.db.flexAttributes.get(attributeId);
          const row = rows.find(value => value.attributeId === attributeId);
          if (attribute?.owner !== realmId || attribute.realmId !== realmId
            || attribute.valueType !== field.type
            || row?.owner !== realmId || row.realmId !== realmId
            || row.id !== flexValueId({ entityType: 'user', entityId: clientUserId, realmId }, attributeId)) continue;
          values.push({ key: keys[field.key], valueType: field.type, value: row.value });
        }
        return deserialize(values);
      });
  }

  observeForCoach(realmId: string, clientUserId: string,
    onChange: (profile: ClientIntake | null) => void, onError: (error: unknown) => void) {
    return liveQuery(() => this.readForCoach(realmId, clientUserId))
      .subscribe({ next: onChange, error: onError });
  }

  /** Only the client mirrors a record into an approved relationship; coach is read-only in UI. */
  async shareWithCoach(profile: ClientIntake, relationship: IntakeRelationship): Promise<void> {
    const { relationshipId: realmId, coachUserId } = relationship;
    const clientUserId = this.actorUserId;
    await this.db.transaction('rw', this.db.realms, this.db.members,
      this.db.flexAttributes, this.db.flexValues, async () => {
        await this.approvedRelationship(realmId, coachUserId, clientUserId);
        const target = { entityType: 'user' as const, entityId: clientUserId, realmId };
        const stampId = flexValueId(target, flexAttributeId(realmId, keys.updatedAt));
        const existing = await this.db.flexValues.get(stampId);
        if (typeof existing?.value === 'string'
          && Date.parse(existing.value) >= Date.parse(profile.updatedAt)) return;
        for (const entry of serialize(profile)) {
          const attributeId = flexAttributeId(realmId, entry.key);
          const existingAttribute = await this.db.flexAttributes.get(attributeId);
          if (existingAttribute && (existingAttribute.owner !== realmId
            || existingAttribute.realmId !== realmId || existingAttribute.valueType !== entry.valueType)) {
            throw new Error('CLIENT_INTAKE_CONFLICT');
          }
          if (!existingAttribute) await this.db.flexAttributes.add({
            id: attributeId, realmId, owner: realmId, key: entry.key,
            valueType: entry.valueType,
          });
          const valueId = flexValueId(target, attributeId);
          const old = await this.db.flexValues.get(valueId);
          if (old && (old.owner !== realmId || old.realmId !== realmId
            || old.entityId !== clientUserId || old.entityType !== 'user'
            || old.attributeId !== attributeId)) throw new Error('CLIENT_INTAKE_CONFLICT');
          if (old) await this.db.flexValues.update(valueId, { value: entry.value });
          else await this.db.flexValues.add({
            id: valueId, realmId, owner: realmId,
            entityType: 'user', entityId: clientUserId, attributeId,
            value: entry.value,
          });
        }
      });
  }

  async shareWithCoaches(profile: ClientIntake, coaches: readonly IntakeRelationship[]): Promise<void> {
    for (const coach of coaches) await this.shareWithCoach(profile, coach);
  }
}
