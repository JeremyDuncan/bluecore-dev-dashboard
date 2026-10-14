// Wraps the sidebar's category (section) component so only the section with the current page stays
// open. On every navigation, a section that doesn't contain the current page is re-created, which
// resets it to collapsed: a section you opened earlier closes when you move elsewhere, nested ones
// included. The section with the current page keeps its state, so you can still close it yourself.
// (autoCollapseCategories in docusaurus.config.js closes sibling sections as another one opens.)
import React from 'react';
import Category from '@theme-original/DocSidebarItem/Category';
import {isActiveSidebarItem} from '@docusaurus/plugin-content-docs/client';

export default function CategoryWrapper(props) {
  const active = isActiveSidebarItem(props.item, props.activePath);
  return <Category key={active ? 'active' : props.activePath} {...props} />;
}
