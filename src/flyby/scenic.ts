// Which level files the menu flies through.

/** Cutscenes are tiny sets; title levels of TR1–3 are a single room. */
export function isScenic(name: string, mod: string): boolean {
    if (!/\.(phd|tub|tr2|tr4)$/i.test(name)) return false;
    if (/^(cut|vict)/i.test(name)) return false;
    if (/^title/i.test(name) && !mod.startsWith('tr4')) return false;
    return true;
}
