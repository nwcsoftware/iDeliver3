/* Single source of truth for the application name and version.

   Keep APP_VERSION in step with the "version" field in package.json — bump both
   together when releasing. Everything that displays the version (login screen,
   About popup, …) reads it from here, so there is only one place to change. */

export const APP_NAME    = 'iDeliver III'
export const APP_VERSION = '3.00.018'

/* "iDeliver III · v3.00.018" */
export const APP_VERSION_LABEL = `${APP_NAME} · v${APP_VERSION}`
