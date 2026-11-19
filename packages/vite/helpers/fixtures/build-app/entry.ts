import { providerLabel, capValue } from '@nativescript/core/ui/label';
import { iosTimer } from '@nativescript/core/timer';
import { sharedGlobals } from '@nativescript/core/globals';
import { sharedDep } from '@nativescript/core/shared';
import { coreExtended, providerExtended } from '@nativescript/core/extended';

export const markers = [providerLabel, iosTimer, sharedGlobals, sharedDep, coreExtended, providerExtended];
export { capValue };
