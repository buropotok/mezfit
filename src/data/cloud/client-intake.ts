import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import {
  FlexAttributesRepository, type FlexAttributeInput, type FlexResolvedValue,
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
    birthDate, sex: sex === 'male' || sex === 'female' ? sex : 'undisclosed',
    weightKg: weight?.valueType === 'number' && typeof weight.value === 'number'
      ? weight.value : null, updatedAt,
  };
  return validateClientIntake(profile) ? null : profile;
}

/** Client registration stays in the actor's private realm; coach visibility needs a separate approved access contract. */
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

}
