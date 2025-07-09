import { join }                         from 'https://deno.land/std@0.224.0/path/mod.ts';
import { ErrorLogger }                  from '#src/ErrorLogger.ts';
import { HTMLWindow }                   from '#src/HTMLWindow.ts';
import { Network }                      from '#src/Network.ts';
import { AppData }                      from './AppData.ts';
import { JSONDiff }                     from './JSONDiff.ts';
import { Formula }                      from './formula/Formula.ts';

// Initialize the error logger
ErrorLogger.initialize();

// Initialize the network
Network.initialize();

// Watch for changes to the data that requires compilation
//JSONDiff.watch(
//    'assets/*/groups/*/requirements/*/addressA',
//    (refPath: any[]) => {
//        const obj = refPath[refPath.length - 2];
//        const value = refPath[refPath.length - 1];
//        obj.compiledA = Formula.compile(value);
//    }
//);
//
//// Watch for changes to the data that requires compilation
//JSONDiff.watch(
//    'assets/*/groups/*/requirements/*/addressB',
//    (refPath: any[]) => {
//        const obj = refPath[refPath.length - 2];
//        const value = refPath[refPath.length - 1];
//        obj.compiledB = Formula.compile(value);
//    }
//);


AppData.loadData();

// Open the flash player
const command = new Deno.Command(join('internals', 'fp.exe'), {
    args: ['http://localhost:8080/./internals/assets/firmware.swf'],
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