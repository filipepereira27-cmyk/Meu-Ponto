/**
 * Bloqueio do portal com Face ID / Touch ID / código do aparelho, via WebAuthn
 * (chave de acesso do próprio aparelho). Não há servidor: a chave serve apenas para
 * confirmar que quem abre o portal é o dono do aparelho.
 *
 * Importante: é uma proteção de acesso à tela. Os dados ficam no armazenamento do
 * navegador, protegido pela criptografia do iPhone enquanto ele estiver bloqueado.
 */

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function lockSupported(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && window.isSecureContext
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Cria a chave de acesso (pede Face ID). Devolve o ID da credencial. */
export async function enrollLock(): Promise<string> {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Meu Ponto Digital', id: location.hostname },
      user: { id: random(16), name: 'Meu Ponto Digital', displayName: 'Meu Ponto Digital (este aparelho)' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Não foi possível ativar a proteção.');
  return b64(credential.rawId);
}

/** Pede Face ID / código. Verdadeiro se o dono confirmou. */
export async function verifyOwner(credentialId: string): Promise<boolean> {
  try {
    const result = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: unb64(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!result;
  } catch {
    return false;
  }
}
