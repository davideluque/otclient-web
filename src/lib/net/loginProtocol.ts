import { OutputPacket } from './OutputPacket';
import { InputPacket } from './InputPacket';
import type { XteaKey } from './xtea';

/** OT 7.6 client version constants. */
const CLIENT_OS = 2; // Windows
const CLIENT_VERSION = 760;

export interface CharacterInfo {
  name: string;
  worldName: string;
  worldIp: string;
  worldPort: number;
}

export interface LoginResponse {
  motd?: string;
  characters: CharacterInfo[];
  premiumDays: number;
}

export interface LoginError {
  message: string;
}

/**
 * Build the login server request packet.
 * This is sent to the login server (port 7171) to get the character list.
 */
export function buildLoginPacket(
  accountNumber: number,
  password: string,
  xteaKey: XteaKey,
): OutputPacket {
  const out = new OutputPacket();

  out.addU8(0x01); // Login server opcode

  out.addU16(CLIENT_OS);
  out.addU16(CLIENT_VERSION);

  // RSA-encrypted block starts here in a real implementation.
  // For now, send plaintext (works with some OT servers configured without RSA).

  // XTEA key (4 × U32)
  out.addU32(xteaKey[0]);
  out.addU32(xteaKey[1]);
  out.addU32(xteaKey[2]);
  out.addU32(xteaKey[3]);

  // Account number and password
  out.addU32(accountNumber);
  out.addString(password);

  return out;
}

/**
 * Build the game server login packet.
 * Sent to the game server (port 7172) after selecting a character.
 */
export function buildGameLoginPacket(
  accountNumber: number,
  characterName: string,
  password: string,
  xteaKey: XteaKey,
): OutputPacket {
  const out = new OutputPacket();

  out.addU8(0x0a); // Game server opcode

  out.addU16(CLIENT_OS);
  out.addU16(CLIENT_VERSION);

  // XTEA key
  out.addU32(xteaKey[0]);
  out.addU32(xteaKey[1]);
  out.addU32(xteaKey[2]);
  out.addU32(xteaKey[3]);

  // Character credentials
  out.addU32(accountNumber);
  out.addString(characterName);
  out.addString(password);

  return out;
}

/**
 * Parse the login server response (character list or error).
 */
export function parseLoginResponse(packet: InputPacket): LoginResponse | LoginError {
  const opcode = packet.getU8();

  if (opcode === 0x0a) {
    // Error
    return { message: packet.getString() };
  }

  let motd: string | undefined;
  if (opcode === 0x14) {
    // MOTD
    motd = packet.getString();
    // Next byte should be character list opcode
    packet.getU8(); // 0x64
  }

  // Character list
  const charCount = packet.getU8();
  const characters: CharacterInfo[] = [];

  for (let i = 0; i < charCount; i++) {
    const name = packet.getString();
    const worldName = packet.getString();

    // IP address as 4 bytes
    const ip1 = packet.getU8();
    const ip2 = packet.getU8();
    const ip3 = packet.getU8();
    const ip4 = packet.getU8();
    const worldIp = `${ip1}.${ip2}.${ip3}.${ip4}`;

    const worldPort = packet.getU16();

    characters.push({ name, worldName, worldIp, worldPort });
  }

  const premiumDays = packet.getU16();

  return { motd, characters, premiumDays };
}

/** Type guard for LoginError. */
export function isLoginError(response: LoginResponse | LoginError): response is LoginError {
  return 'message' in response;
}
