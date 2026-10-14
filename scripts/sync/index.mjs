// Runs every sync step: Google Docs → Drive downloads → Box → READMEs → code reference docs → llms.txt.
import {syncBox} from './box.mjs';
import {syncCodeDocs} from './code-docs.mjs';
import {syncDriveDownloads} from './drive-downloads.mjs';
import {syncGoogleDocs} from './google-docs.mjs';
import {syncProjectStatus} from './project-status.mjs';
import {buildLlmsTxt} from './llms-txt.mjs';
import {syncReadmes} from './readmes.mjs';

// await syncGoogleDocs();
await syncDriveDownloads();
await syncBox();
await syncReadmes();
await syncProjectStatus();
await syncCodeDocs();
await buildLlmsTxt();
