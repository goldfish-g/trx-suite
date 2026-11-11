// tombs.nexus: the doorway and the name, as the brand kit draws them for a
// dark background. Its colours are the brand's whatever the menu's look.

import logo from './brand/logo.svg';

export function BrandLogo({ className }: { className?: string }) {
    return <img className={className} src={logo} alt="tombs.nexus" draggable={false} />;
}
