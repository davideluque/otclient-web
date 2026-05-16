import { OutputPacket } from '../common/OutputPacket';
import { InputPacket } from '../common/InputPacket';
import type { CharacterInfo, LoginResponse, LoginError } from '../common/types';

const CLIENT_OS = 2; // Windows
const DEFAULT_CLIENT_VERSION = 760;

/**
 * Three U32 file signatures sent in the canonical OT 7.6 login packet:
 * Tibia.dat, Tibia.spr, Tibia.pic. Servers typically validate against
 * the assets a client claims to be using. jamera ignores the values, but
 * other 7.6 forks check them, so the real signatures should eventually
 * be plumbed in from the asset loaders.
 */
export interface ClientSignatures {
  dat: number;
  spr: number;
  pic: number;
}

const NO_SIGNATURES: ClientSignatures = { dat: 0, spr: 0, pic: 0 };

/**
 * Build the OT 7.6 login server request packet.
 *
 * Wire layout: `U8 0x01, U16 os, U16 clientVersion, U32 datSig, U32 sprSig,
 * U32 picSig, U32 account, String password`. No RSA, no XTEA — those came
 * in later Tibia versions and are not part of the 7.6 protocol.
 */
export function buildLoginPacket(
  accountNumber: number,
  password: string,
  clientVersion: number = DEFAULT_CLIENT_VERSION,
  signatures: ClientSignatures = NO_SIGNATURES,
): OutputPacket {
  const out = new OutputPacket();

  out.addU8(0x01); // Login server opcode

  out.addU16(CLIENT_OS);
  out.addU16(clientVersion);

  // File signatures — three U32 values for dat/spr/pic, in that order.
  out.addU32(signatures.dat);
  out.addU32(signatures.spr);
  out.addU32(signatures.pic);

  // Account number and password
  out.addU32(accountNumber);
  out.addString(password);

  return out;
}

/**
 * Build the OT 7.6 game server login packet.
 *
 * Wire layout: `U8 0x0a, U16 os, U16 clientVersion, U8 isSetGM, U32 account,
 * String characterName, String password`. The `isSetGM` byte is a flag the
 * server interprets — most servers ignore it for non-GM accounts. No XTEA.
 */
export function buildGameLoginPacket(
  accountNumber: number,
  characterName: string,
  password: string,
  clientVersion: number = DEFAULT_CLIENT_VERSION,
  isSetGM: boolean = false,
): OutputPacket {
  const out = new OutputPacket();

  out.addU8(0x0a); // Game server opcode

  out.addU16(CLIENT_OS);
  out.addU16(clientVersion);
  out.addU8(isSetGM ? 1 : 0);

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
