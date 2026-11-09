import { t } from '../../shared/i18n';

/** Turn an error from `request()` into one short, plain sentence for the UI. */
export function errorText(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code) : '';
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  switch (code) {
    case 'no-reply':
      return t('errNoReply');
    case 'unauthorized':
    case 'auth':
    case 'bad-credentials':
    case 'token-invalid':
    case 'not-signed-in':
    case 'no-auth':
      return t('errAuth');
    case 'bad-token':
      return t('errBadToken');
    case 'rate-limited':
    case 'rate-limit':
      return t('errRateLimit');
    case 'network':
    case 'offline':
      return t('errNetwork');
    case 'not-found':
      return t('errNotFound');
    case 'forbidden':
    case 'no-permission':
      return t('errNoPermission');
    case 'expired':
    case 'expired_token':
      return t('codeExpired');
    case 'denied':
    case 'access_denied':
      return t('errDenied');
    case 'repo-exists':
    case 'name-taken':
      return t('errRepoExists');
    case 'no-repo':
      return t('errNoRepo');
    case 'repo-not-empty':
      return t('errRepoNotEmpty');
    default:
      return msg || t('errGeneric');
  }
}

export function errorCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code) : '';
}
