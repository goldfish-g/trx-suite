// tombs.nexus: the doorway and the name, as the brand kit draws them for a
// dark background. Drawn in the page, not as a picture, so that the kit's
// torch amber (the doorway's light and ".NEXUS") can take the colour of the
// menu's look; the styles set it as the logo's color.

import source from './brand/logo.svg?raw';

const TORCH_AMBER = /#F0A33C/gi;

const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1];
// What is inside the kit's <svg>, less its title: the logo's name is the label below.
const drawing = source
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(TORCH_AMBER, 'currentColor');

export function BrandLogo({ className }: { className?: string }) {
    return <svg className={className} viewBox={viewBox} role="img" aria-label="tombs.nexus" dangerouslySetInnerHTML={{ __html: drawing }} />;
}
