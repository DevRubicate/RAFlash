import { join }                         from 'https://deno.land/std@0.224.0/path/mod.ts';
import HTMLWindow                       from '#src/HTMLWindow.ts';
import Network                          from '#src/Network.ts';

// Initialize the network
Network.initialize();

// Open the flash player
const command = new Deno.Command(join('internals', 'fp.exe'), {
    args: ['http://localhost:8080/internals/assets/firmware.swf'],
    stdin: 'null',              // Disable input
    stdout: 'null',             // Disable output
    stderr: 'null',             // Disable error messages
    windowsRawArguments: true,  // Prevents extra shell processing on Windows
});
const child = command.spawn();
await child.status; // Keep server alive until RAFlash is closed

// Close the network
Network.close();

// Close any remaining HTML windows
await HTMLWindow.shutdown();

// Exit the process
Deno.exit();
