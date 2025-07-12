// JSON diff
const getEditedPaths = (e, n) => {
    const o = [];
    for (const f in e)
        if (n.hasOwnProperty(f)) {
            if (typeof e[f] == 'object' && typeof n[f] == 'object' && JSON.stringify(e[f]) === JSON.stringify(n[
                f]) || e[f] === n[f])
                continue;
            if (e[f] === '@{}' || e[f] === '@[]') {
                const i = n[f] === '@{}' ? {} : n[f] === '@[]' ? [] : n[f];
                e[f] === '@{}' ? JSON.stringify(n[f]) !== '{}' && o.push([f, {}, i]) : JSON.stringify(n[f]) !==
                    '[]' && o.push([f, [], i]);
            } else
                o.push([f, e[f], n[f]]);
        }
    return o;
}
const getPathsDiff = (e, n) => {
    const o = [];
    let f = 0;
    for (const i in e)
        if (!(i in n)) {
            const r = e[i] === '@{}' ? {} : e[i] === '@[]' ? [] : e[i];
            o[f] = [i, r], f++;
        }
    return o;
}
const c = (e, n, o, f) => {
    const i = f ? e ? '[' : '.' : '/',
        r = f ? e ? ']' : '' : e ? '[]' : '';
    return n === '__start__' ? `${f && e ? '[' : ''}${o}${r}` : `${n}${i}${o}${r}`;
}
const getStructPath = (e, n = !1, o, f = '__start__') => {
    o === void 0 && (o = Array.isArray(e) ? {
        __root__: '@[]'
    } : {
        __root__: '@{}'
    });
    for (const i of Object.keys(e)) {
        const r = c(Array.isArray(e), f, i, n);
        typeof e[i] == 'object' && e[i] !== null ? (Object.keys(e[i]).length === 0 ? o[r] = e[i] : o[r] = Array
            .isArray(e[i]) ? '@[]' : '@{}', getStructPath(e[i], n, o, r)) : o[r] = e[i];
    }
    return o;
}
const N = (e) => (e.edited = e.edited.filter((n) => !(typeof n[1] == 'object' && n[2] === '@{}')).map((n) => n[2] ===
        '@{}' ? [n[0], n[1], {}] : n[2] === '@[]' ? [n[0], n[1],
            []
        ] : n), e),
    $ = {
        isLodashLike: !1
    }
const getDiff = (e, n, o) => {
    const {
        isLodashLike: f
    } = o ?? $, i = {
            added: [],
            removed: [],
            edited: []
        }, r = typeof e == 'string' ? JSON.parse(e) : e, _ = typeof n == 'string' ? JSON.parse(n) : n, s =
        getStructPath(r, f), y = getStructPath(_, f);
    return i.removed = getPathsDiff(s, y), i.added = getPathsDiff(y, s), i.edited = getEditedPaths(s, y), N(i);
};

export { getDiff };