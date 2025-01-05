class AppData {
    static data:any = {
        assets: [
            {
                id: 21368,
                points: 10,
                name: 'Ice Rock Island Complete!',
                description: 'Ice Rock Island is so cool and this achivo is all about clearing it.',
                state: 'Paused',
                category: 'Core',
                changes: false,
                groups: [
                    {
                        id: 1,
                        type: 'CORE',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.health', cmp: '=', typeB: 'Value', addressB: 'root.mana', hits: 5, maxHits: 10},
                            {id: 2, flag: '', typeA: 'Mem', addressA: 'root.arrows', cmp: '=', typeB: 'Value', addressB: 'root.armor', hits: 5, maxHits: 10},
                            {id: 3, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.age', hits: 5, maxHits: 10},
                        ]
                    },
                    {
                        id: 2,
                        type: 'ALT',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.stuff', cmp: '=', typeB: 'Value', addressB: 'root.stuff', hits: 5, maxHits: 10},
                        ]
                    },
                    {
                        id: 3,
                        type: 'ALT',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                            {id: 2, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                            {id: 3, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                        ]
                    },
                ]
            },
            {
                id: 22369,
                points: 10,
                name: 'Cobalt Mine Complete!',
                description: 'Cobalt Mine is so cool and this achivo is all about clearing it.',
                state: 'Paused',
                category: 'Core',
                changes: false,
                groups: [
                    {
                        id: 1,
                        type: 'CORE',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.health', cmp: '=', typeB: 'Value', addressB: 'root.mana', hits: 5, maxHits: 10},
                            {id: 2, flag: '', typeA: 'Mem', addressA: 'root.arrows', cmp: '=', typeB: 'Value', addressB: 'root.armor', hits: 5, maxHits: 10},
                            {id: 3, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.age', hits: 5, maxHits: 10},
                        ]
                    },
                    {
                        id: 2,
                        type: 'ALT',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.stuff', cmp: '=', typeB: 'Value', addressB: 'root.stuff', hits: 5, maxHits: 10},
                        ]
                    },
                    {
                        id: 3,
                        type: 'ALT',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                            {id: 2, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                            {id: 3, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                        ]
                    },
                ]
            },
            {
                id: 23370,
                points: 10,
                name: 'Golden Castle Complete!',
                description: 'Golden Castle is so cool and this achivo is all about clearing it.',
                state: 'Active',
                category: 'Core',
                changes: false,
                groups: [
                    {
                        id: 1,
                        type: 'CORE',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.health', cmp: '=', typeB: 'Value', addressB: 'root.mana', hits: 5, maxHits: 10},
                            {id: 2, flag: '', typeA: 'Mem', addressA: 'root.arrows', cmp: '=', typeB: 'Value', addressB: 'root.armor', hits: 5, maxHits: 10},
                            {id: 3, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.age', hits: 5, maxHits: 10},
                        ]
                    },
                    {
                        id: 2,
                        type: 'ALT',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.stuff', cmp: '=', typeB: 'Value', addressB: 'root.stuff', hits: 5, maxHits: 10},
                        ]
                    },
                    {
                        id: 3,
                        type: 'ALT',
                        requirements: [
                            {id: 1, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                            {id: 2, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                            {id: 3, flag: '', typeA: 'Mem', addressA: 'root.enemies', cmp: '=', typeB: 'Value', addressB: 'root.boss.life', hits: 5, maxHits: 10},
                        ]
                    },
                ]
            },
        ],
    };
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

export {AppData}
