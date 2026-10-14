// Wraps every page: adds the "Ask the docs" chat box.
import React from 'react';
import AskDocs from '@site/src/components/AskDocs';

export default function Root({children}) {
  return (
    <>
      {children}
      <AskDocs />
    </>
  );
}
