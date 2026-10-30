import { spawn } from 'node:child_process';
import type { BoardSession, SessionVault } from './project-protocol.ts';

// Security.framework receives the credential over stdin, never argv or a file.
const program = `import Foundation
import Security
let input = FileHandle.standardInput.readDataToEndOfFile()
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.lar-factory.t3-session", kSecAttrAccount as String: "board"]
if CommandLine.arguments[1] == "read" {
 var read = query
 read[kSecReturnData as String] = true
 var result: CFTypeRef?
 let status = SecItemCopyMatching(read as CFDictionary, &result)
 if status == errSecItemNotFound { exit(0) }
 guard status == errSecSuccess, let data = result as? Data else { exit(1) }
 FileHandle.standardOutput.write(data)
} else {
 let attributes = [kSecValueData as String: input]
 let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
 if status == errSecItemNotFound {
  var insert = query
  insert[kSecValueData as String] = input
  insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { exit(1) }
 } else if status != errSecSuccess { exit(1) }
}
`;

function keychain(operation: 'read' | 'write', input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/swift', ['-e', program, operation], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Keychain unavailable')); }, 30_000);
    child.stdout.setEncoding('utf8').on('data', data => { output += data; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Keychain unavailable')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error('Keychain unavailable')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** macOS credential storage, accessible only while the user's Keychain is unlocked. */
export function keychainSessionVault(): SessionVault {
  return {
    async read() {
      const raw = await keychain('read');
      if (!raw) return undefined;
      try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null || !('token' in value) || !('sessionId' in value) || !('expiresAt' in value) || typeof value.token !== 'string' || typeof value.sessionId !== 'string' || typeof value.expiresAt !== 'string') throw Error();
        return value as BoardSession;
      } catch { throw new Error('Invalid board credential'); }
    },
    async write(session) { await keychain('write', JSON.stringify(session)); },
  };
}
