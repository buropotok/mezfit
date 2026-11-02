import { liveQuery } from 'dexie';
import { profileRelationships } from './user-profile-relationships';
import type { MezfitCloudDatabase } from './database';
import {
  FlexAttributesRepository, flexAttributeId, flexValueId, type FlexAttributeInput, type FlexResolvedValue,
} from './flex-attributes';
import { parseLocalDate, getTodayLocalDate } from '../../ui/date-picker/datePickerDate';

export type UserProfileSex = 'male' | 'female' | 'undisclosed';
export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: string;
  sex: UserProfileSex;
  weightKg: number | null;
  updatedAt: string;
}
export type UserProfileDraft = Omit<UserProfile, 'updatedAt'>;
export type UserProfileDefaults = Pick<UserProfileDraft, 'firstName' | 'lastName'>;

export const USER_PROFILE_KEYS = {
  firstName: 'profile_firstName',
  lastName: 'profile_lastName',
  email: 'profile_email',
  phone: 'profile_phone',
  birthDate: 'profile_birthDate',
  sex: 'profile_sex',
  weightKg: 'profile_weightKg',
  updatedAt: 'profile_updatedAt',
} as const;
const legacyKeys = {
  firstName: 'ClientIntake_FirstName',
  lastName: 'ClientIntake_LastName',
  email: 'ClientIntake_Email',
  phone: 'ClientIntake_Phone',
  birthDate: 'ClientIntake_BirthDate',
  sex: 'ClientIntake_Sex',
  weightKg: 'ClientIntake_WeightKg',
  updatedAt: 'ClientIntake_UpdatedAt',
} as const;
const userIdPattern = /^tg:[1-9]\d*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9 ()\-]{7,25}$/;

export function initialUserProfile(defaults: UserProfileDefaults): UserProfileDraft {
  return { firstName: defaults.firstName, lastName: defaults.lastName,
    email: '', phone: '', birthDate: '', sex: 'undisclosed', weightKg: null };
}

export function validateUserProfile(value: UserProfileDraft, today = getTodayLocalDate()): string | null {
  if (value.firstName.trim().length > 100
    || value.lastName.trim().length > 100) return 'Проверьте имя и фамилию';
  if (value.email && (!emailPattern.test(value.email) || value.email.length > 254))
    return 'Проверьте адрес E-mail';
  if (value.phone && !phonePattern.test(value.phone)) return 'Проверьте номер телефона';
  const birth = parseLocalDate(value.birthDate);
  const current = parseLocalDate(today);
  if (value.birthDate && (!birth || !current || birth.year < 1900 || value.birthDate > today))
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

const fields: ReadonlyArray<{ key: keyof UserProfile; type: 'string' | 'number' }> = [
  { key: 'firstName', type: 'string' }, { key: 'lastName', type: 'string' },
  { key: 'email', type: 'string' }, { key: 'phone', type: 'string' },
  { key: 'birthDate', type: 'string' },
  { key: 'sex', type: 'string' }, { key: 'weightKg', type: 'number' },
  { key: 'updatedAt', type: 'string' },
];

function serialize(profile: UserProfile): FlexAttributeInput[] {
  return fields.map(({ key, type }) => ({ key: USER_PROFILE_KEYS[key], valueType: type, value: profile[key] }));
}

function deserialize(values: readonly FlexResolvedValue[], keys: Record<keyof UserProfile, string>): UserProfile | null {
  const entries = new Map(values.map(row => [row.key, row]));
  const text = (key: keyof UserProfile): string | null => {
    const row = entries.get(keys[key]);
    return row?.valueType === 'string' && typeof row.value === 'string' ? row.value : null;
  };
  // Optional business values still need explicit rows before either key set is complete.
  if (fields.some(({ key, type }) => {
    const row = entries.get(keys[key]);
    return !row || row.valueType !== type || (key === 'weightKg'
      ? row.value !== null && typeof row.value !== 'number'
      : typeof row.value !== 'string');
  })) return null;
  const updatedAt = text('updatedAt');
  const firstName = text('firstName');
  const birthDate = text('birthDate');
  const sex = text('sex');
  const validSex = sex === 'male' || sex === 'female' || sex === 'undisclosed' ? sex : null;
  const weight = entries.get(keys.weightKg);
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt)) || firstName === null
    || birthDate === null || validSex === null) return null;
  const profile: UserProfile = {
    firstName, lastName: text('lastName') ?? '',
    email: text('email') ?? '', phone: text('phone') ?? '',
    birthDate, sex: validSex,
    weightKg: weight?.valueType === 'number' && typeof weight.value === 'number'
      ? weight.value : null, updatedAt,
  };
  return validateUserProfile(profile) ? null : profile;
}

function resolveOwnProfile(values: readonly FlexResolvedValue[]): UserProfile | null {
  const current = deserialize(values, USER_PROFILE_KEYS);
  const legacy = deserialize(values, legacyKeys);
  // Old clients may synchronize legacy writes after this device upgrades.
  return legacy && (!current || Date.parse(legacy.updatedAt) > Date.parse(current.updatedAt))
    ? legacy : current;
}

/** One private profile per authenticated actor, independent of Coach/Client roles. */
export class UserProfileRepository {
  private readonly flexible: FlexAttributesRepository<MezfitCloudDatabase>;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    if (!userIdPattern.test(actorUserId)) throw new Error('INVALID_USER_PROFILE_ACTOR');
    this.flexible = new FlexAttributesRepository(db, actorUserId);
  }

  private ownTarget() {
    return { entityType: 'user' as const, entityId: this.actorUserId, realmId: this.actorUserId };
  }

  private async publishedVersion(profile: UserProfile, realmIds: readonly string[]): Promise<string> {
    const copies: Array<readonly [string, UserProfile | null]> = [];
    for (const realmId of realmIds) {
      const values = await this.flexible.getValues({
        entityType: 'publishedUser', entityId: this.actorUserId, realmId,
      });
      copies.push([realmId, deserialize(values, USER_PROFILE_KEYS)]);
    }
    return JSON.stringify([profile, copies]);
  }

  /** Derived presentation version; no parallel persistent sync metadata. */
  async publicationVersion(): Promise<string | null> {
    return this.db.transaction('r', [this.db.flexAttributes, this.db.flexValues,
      this.db.adHocSessions, this.db.realms, this.db.members], async () => {
      const profile = await this.readOwn();
      if (!profile) return null;
      const pairs = await profileRelationships(this.db, this.actorUserId);
      return this.publishedVersion(profile, pairs.map(pair => pair.realmId));
    });
  }

  observePublicationVersion(next: (version: string | null) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.publicationVersion()).subscribe({ next, error });
  }

  /** Application publication only. Addon still owns replication and retries. */
  async publishOwn(): Promise<string | null> {
    return this.db.transaction('rw', [this.db.flexAttributes, this.db.flexValues,
      this.db.adHocSessions, this.db.realms, this.db.members], async () => {
      const profile = await this.readOwn();
      if (!profile) return null;
      const pairs = await profileRelationships(this.db, this.actorUserId);
      let incomplete = false;
      for (const pair of pairs) {
        const target = { entityType: 'publishedUser' as const, entityId: this.actorUserId, realmId: pair.realmId };
        const values = await this.flexible.getValues(target);
        const previous = deserialize(values, USER_PROFILE_KEYS);
        const canonicalValues = values.filter(row => Object.values(USER_PROFILE_KEYS).some(key => key === row.key));
        const expectedRows = await this.db.flexValues.bulkGet(fields.map(({ key }) =>
          flexValueId(target, flexAttributeId(pair.realmId, USER_PROFILE_KEYS[key]))));
        const count = expectedRows.filter(row => row !== undefined).length;
        const hasCanonical = canonicalValues.length > 0;
        // A partial incoming download is not permission to rewrite newer fields.
        if (count > canonicalValues.length || (hasCanonical && !previous)) { incomplete = true; continue; }
        if (previous && Date.parse(previous.updatedAt) > Date.parse(profile.updatedAt)) continue;
        await this.flexible.setValues(target, serialize(profile));
      }
      // Do not acknowledge an incomplete copy. Its completion invalidates the observed version.
      return incomplete ? null : this.publishedVersion(profile, pairs.map(pair => pair.realmId));
    });
  }

  /** Public Addon push barrier confirms only the version captured by the caller. */
  async confirmOwnSync(version: string): Promise<boolean> {
    await this.db.cloud.sync({ purpose: 'push', wait: true });
    return await this.publicationVersion() === version;
  }

  observePublished(userId: string, realmId: string,
    next: (profile: UserProfile | null) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.readPublished(userId, realmId)).subscribe({ next, error });
  }

  async readPublished(userId: string, realmId: string): Promise<UserProfile | null> {
    return deserialize(await this.flexible.getValues({
      entityType: 'publishedUser', entityId: userId, realmId,
    }), USER_PROFILE_KEYS);
  }

  async readOwn(): Promise<UserProfile | null> {
    return resolveOwnProfile(await this.flexible.getValues(this.ownTarget()));
  }

  observeOwn(onChange: (profile: UserProfile | null) => void, onError: (error: unknown) => void) {
    return liveQuery(() => this.readOwn()).subscribe({ next: onChange, error: onError });
  }

  /** Explicit, atomic upgrade. Read/observe never write or run a sync loop. */
  async migrateOwn(): Promise<void> {
    await this.db.transaction('rw', this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions, async () => {
      const values = await this.flexible.getValues(this.ownTarget());
      const profile = resolveOwnProfile(values);
      const canonical = deserialize(values, USER_PROFILE_KEYS);
      const hasCanonical = values.some(row => Object.values(USER_PROFILE_KEYS).some(key => key === row.key));
      // Never overwrite a partial incoming canonical download, even before its marker arrives.
      if (hasCanonical && !canonical) return;
      if (canonical && profile && Date.parse(canonical.updatedAt) >= Date.parse(profile.updatedAt)) return;
      if (profile) await this.flexible.setValues(this.ownTarget(), serialize(profile));
    });
  }

  async createOwn(draft: UserProfileDraft): Promise<UserProfile> {
    return this.writeOwn(draft, 'create');
  }

  async updateOwn(draft: UserProfileDraft): Promise<UserProfile> {
    return this.writeOwn(draft, 'update');
  }

  async saveOwn(draft: UserProfileDraft): Promise<UserProfile> {
    return this.writeOwn(draft);
  }

  private async writeOwn(draft: UserProfileDraft, operation?: 'create' | 'update'): Promise<UserProfile> {
    const normalized: UserProfileDraft = {
      firstName: draft.firstName.trim(), lastName: draft.lastName.trim(),
      email: draft.email.trim().toLowerCase(), phone: draft.phone.trim(),
      birthDate: draft.birthDate, sex: draft.sex, weightKg: draft.weightKg,
    };
    const error = validateUserProfile(normalized);
    if (error) throw new Error(error);
    return this.db.transaction('rw', this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions, async () => {
      const values = await this.flexible.getValues(this.ownTarget());
      const previous = resolveOwnProfile(values);
      if (values.some(row => Object.values(USER_PROFILE_KEYS).some(key => key === row.key))
        && !deserialize(values, USER_PROFILE_KEYS)) {
        throw new Error('Анкета загружена не полностью. Введённые данные сохранены в форме. Повторите сохранение позже.');
      }
      if (operation === 'create' && previous) throw new Error('Анкета уже существует. Откройте её повторно.');
      if (operation === 'update' && !previous) throw new Error('Анкета не найдена. Откройте её повторно.');
      const timestamp = Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0);
      const profile: UserProfile = { ...normalized, updatedAt: new Date(timestamp).toISOString() };
      await this.flexible.setValues(this.ownTarget(), serialize(profile));
      return profile;
    });
  }
}
