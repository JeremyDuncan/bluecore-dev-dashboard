// The theme's phone menu, also used for the navbar on narrow desktop windows. Docusaurus only
// switches to the hamburger at 996px, but our navbar menus stop fitting next to the logo well before
// that, so the navbar collapses below NAVBAR_BREAKPOINT instead. The docs sidebar keeps the theme's
// 996px breakpoint: between the two, the hamburger menu only holds the navbar links.
// The same width is in src/css/custom.css ("Compact navbar"); change both together.
import React, {useEffect} from 'react';
import {useWindowSize} from '@docusaurus/theme-common';
import {useLockBodyScroll, useNavbarMobileSidebar} from '@docusaurus/theme-common/internal';
import NavbarMobileSidebarLayout from '@theme/Navbar/MobileSidebar/Layout';
import NavbarMobileSidebarHeader from '@theme/Navbar/MobileSidebar/Header';
import NavbarMobileSidebarPrimaryMenu from '@theme/Navbar/MobileSidebar/PrimaryMenu';
import NavbarMobileSidebarSecondaryMenu from '@theme/Navbar/MobileSidebar/SecondaryMenu';

const NAVBAR_BREAKPOINT = 1179;

export default function NavbarMobileSidebar() {
  const mobileSidebar = useNavbarMobileSidebar();
  const compact = useWindowSize({desktopBreakpoint: NAVBAR_BREAKPOINT}) === 'mobile';
  useLockBodyScroll(mobileSidebar.shown);
  // The theme closes the menu when the window grows past 996px; close it past our breakpoint too
  useEffect(() => {
    if (!compact && mobileSidebar.shown) mobileSidebar.toggle();
  }, [compact, mobileSidebar]);
  if (mobileSidebar.disabled || !compact) {
    return null;
  }
  return (
    <NavbarMobileSidebarLayout
      header={<NavbarMobileSidebarHeader />}
      primaryMenu={<NavbarMobileSidebarPrimaryMenu />}
      secondaryMenu={<NavbarMobileSidebarSecondaryMenu />}
    />
  );
}
