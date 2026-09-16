# admin-auth

## Purpose

Gates the Trackify admin upload page behind PocketBase superuser
authentication, with a session that is fully isolated from the visitor
app's authentication so the two can coexist without interference.

## ADDED Requirements

### Requirement: Admin page requires an authenticated superuser
The admin page SHALL present catalog-management functionality only when the
current session is an authenticated PocketBase superuser. Whenever no valid
superuser session exists, the page SHALL present a login form and SHALL NOT
offer any upload, staging, or catalog-write functionality.

#### Scenario: Anonymous visitor opens the admin page
- **WHEN** a visitor opens the admin page without a valid superuser session
- **THEN** only the superuser login form is shown
- **AND** no catalog data is fetched and no upload controls are offered

#### Scenario: Authenticated superuser opens the admin page
- **WHEN** a valid superuser session exists in the admin page's storage
- **THEN** the catalog upload interface is shown without requiring a new login

### Requirement: Superuser login with email and password
The admin page SHALL authenticate a user by submitting an email address and
password to PocketBase's superuser auth endpoint. On success the page SHALL
store the resulting session for subsequent requests and reveal the catalog
management interface. On failure the page SHALL display an error message and
remain on the login form.

#### Scenario: Successful login
- **WHEN** a user submits valid superuser credentials
- **THEN** a superuser session is established and the upload interface is shown

#### Scenario: Failed login
- **WHEN** a user submits an unknown email or a wrong password
- **THEN** an error message is displayed and the login form remains shown
- **AND** no session is stored

### Requirement: Admin session is isolated from the visitor app session
The admin page's session storage MUST be independent of the visitor
application's authentication storage (separate storage key on the same
origin). Creating, refreshing, or clearing a superuser session on the admin
page MUST NOT read, overwrite, or invalidate the visitor application's
session in the same browser, and vice versa.

#### Scenario: Superuser login does not evict a visitor session
- **WHEN** a user is signed into the visitor app in one tab and signs into
  the admin page as a superuser in another tab
- **THEN** the visitor app's session remains valid and unaffected

#### Scenario: Superuser logout does not affect the visitor session
- **WHEN** a superuser signs out on the admin page while a visitor session
  exists in another tab
- **THEN** only the admin page's session is cleared

### Requirement: Session display and logout
While authenticated, the admin page SHALL indicate the active superuser
identity and offer a logout action that clears the admin session and returns
the page to the login form.

#### Scenario: Logout returns to login
- **WHEN** an authenticated superuser activates the logout action
- **THEN** the stored superuser session is cleared and the login form is shown

### Requirement: Expired sessions drop back to the login form
When a catalog-management request fails because the session is expired or
invalid, the admin page SHALL clear the stored session and return to the
login form with a message indicating re-authentication is required. In-flight
batch state SHALL be preserved where possible so the user can log in again
and resume without re-selecting files.

#### Scenario: Token expires mid-session
- **WHEN** a catalog write is rejected with an authentication failure while a
  batch upload is in progress
- **THEN** the admin page clears the stored session and shows the login form
- **AND** after re-authentication the staged batch is still available
