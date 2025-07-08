import { AppData } from './AppData.ts';

export class JSONDiff {
    static applyDataDiff(diff:{added:Array<any>, removed:Array<any>, edited:Array<any>}) {
        // Helper function to set a value in the object by path
        function setValue(obj:any, path:string, value:any) {
            const keys = path.split('/');
            let current = obj;
            for (let i = 0; i < keys.length - 1; i++) {
              const key = keys[i].replace(/\[\]$/, ''); // Remove array brackets if present
              current = current[key] = current[key] || (keys[i + 1].match(/\[\]$/) ? [] : {});
            }
            const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
            current[finalKey] = value;
        }
  
        // Helper function to remove a value from the object by path
        function removeValue(obj:any, path:string) {
            const keys = path.split('/');
            let current = obj;
            for (let i = 0; i < keys.length - 1; i++) {
              const key = keys[i].replace(/\[\]$/, '');
              if (!(key in current)) return; // Path does not exist
              current = current[key];
            }
            const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
            delete current[finalKey];
        }
  
        // Apply added changes
        if (diff.added) {
            for (const [path, value] of diff.added) {
              setValue(AppData.data, path, value);
            }
        }
  
        // Apply removed changes
        if (diff.removed) {
            for (const [path] of diff.removed) {
              removeValue(AppData.data, path);
            }
        }
  
        // Apply edited changes
        if (diff.edited) {
            for (const [path, , newValue] of diff.edited) {
              setValue(AppData.data, path, newValue);
            }
        }
    }
}