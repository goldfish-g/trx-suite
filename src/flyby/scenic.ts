// Which level files the menu flies through.

/** Cutscenes are tiny sets, and title levels are no place to fly through. */
export function isScenic(name: string): boolean {
    if (!/\.(phd|tub|tr2|tr4)$/i.test(name)) return false;
    if (/^(cut|vict|title)/i.test(name)) return false;
    return true;
}
