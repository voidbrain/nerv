import { bootstrapApplication } from '@angular/platform-browser';
import { App, appConfig } from './app.ts';
import { takeLoginCode } from './session.ts';
import { registerSurfaces } from './status-card.ts';

registerSurfaces();
// `nerv open` lands here with #code=…: drop it from the address and history before the router reads it.
bootstrapApplication(App, appConfig(takeLoginCode(window))).catch(console.error);
