

    
    
COMPETEN PRODUCT SEPARATION ARCHITECTURE
    
Document ID: COMP-ARCH-PSA-001Title: Competen Product Separation ArchitectureStatus: Governing ArchitectureVersion: 1.0Applies To: Competen Ecosystem, Competen Platform, CompetenPractice, Shared Core ServicesArchitecture Principle: Independent Products, Shared Foundations
    

    
    
    
1. PURPOSE
    
This document establishes the architectural separation between Competen Platform and CompetenPractice.
    
CompetenPractice SHALL NOT be implemented as:
    
a module within Competen Platform;
    
a workspace within Competen Platform;
    
a clinical role within Competen Platform;
    
a tenant of Competen Platform;
    
an extension of a Competen Platform user account;
    
or a product whose users must first exist inside Competen Platform.
    
Instead:
    
Competen Platform and CompetenPractice are independent products within the wider Competen ecosystem.
    
They may share approved foundational infrastructure and common technical services, but each product SHALL maintain its own:
    
application boundary;
    
entry point;
    
product membership;
    
authorization model;
    
roles and permissions;
    
business data;
    
workflows;
    
user experience;
    
governance;
    
API surface;
    
lifecycle;
    
and product-specific configuration.
    
The purpose of this architecture is to make that separation structural and enforceable rather than dependent on developer convention.
    

    
    
    
2. GOVERNING CONCEPT
    
The Competen ecosystem shall be understood using a building with separate gates model.
    
Competen owns the building.
    
There are separate areas of the building serving different purposes.
    
    
Gate 1 — Competen Platform
    
Gate 1 provides access to Competen Platform.
    
Competen Platform has its own:
    
users;
    
organizations/facilities;
    
clinical and administrative roles;
    
permissions;
    
workflows;
    
datasets;
    
governance;
    
applications;
    
sessions;
    
APIs;
    
and product configuration.
    
    
    
Gate 2 — CompetenPractice
    
Gate 2 provides access to CompetenPractice.
    
CompetenPractice has its own:
    
practitioner accounts;
    
practices;
    
practice memberships;
    
practitioners;
    
practice team members;
    
roles;
    
permissions;
    
patients;
    
appointments;
    
encounters;
    
workflows;
    
configuration;
    
sessions;
    
APIs;
    
and product governance.
    
Entering through Gate 2 SHALL NOT grant access through Gate 1.
    
Entering through Gate 1 SHALL NOT grant access through Gate 2.
    
The two products may share utilities such as:
    
identity infrastructure;
    
notifications;
    
communication services;
    
billing infrastructure;
    
security services;
    
audit infrastructure;
    
storage;
    
hosting;
    
observability;
    
integration infrastructure;
    
and other approved common capabilities.
    
Sharing such services SHALL NOT collapse product boundaries.
    

    
    
    
    
3. CORE ARCHITECTURAL PRINCIPLE
    
The Competen ecosystem SHALL follow the principle:
    
Shared identity may establish who a person is. Product membership establishes where that person belongs. Product authorization establishes what that person may do.
    
These three concepts MUST remain separate.
    
Therefore:
    
IDENTITY ≠ PRODUCT MEMBERSHIP ≠ PRODUCT ROLE
    
A person may possess a Competen identity without belonging to either Competen Platform or CompetenPractice.
    
A person may belong only to CompetenPractice.
    
A person may belong only to Competen Platform.
    
A person may independently belong to both products.
    
No membership SHALL be inferred merely because another membership exists.
    

    
    
    
4. TARGET ECOSYSTEM ARCHITECTURE
    
                         COMPETEN ECOSYSTEM                                │          ┌─────────────────────┴──────────────────────┐          │                                            │          │                                   SHARED FOUNDATIONS          │                                            │          │                                  Identity Infrastructure          │                                  Security Infrastructure          │                                  Notifications          │                                  Communications          │                                  Billing Services          │                                  Audit Infrastructure          │                                  Integration Services          │                                  Storage          │                                  Hosting          │                                  Observability          │                                  Backup & Recovery          │                                            │          ├──────────────────────┬─────────────────────┤          │                      │                     │          ▼                      │                     ▼┌───────────────────────┐        │        ┌────────────────────────┐│  COMPETEN PLATFORM    │        │        │   COMPETENPRACTICE     ││                       │        │        │                        ││       GATE 1          │        │        │        GATE 2          ││                       │        │        │                        ││ Platform Users        │        │        │ Practice Accounts      ││ Facilities            │        │        │ Practices              ││ Platform Roles        │        │        │ Practitioners          ││ Platform Permissions  │        │        │ Practice Teams         ││ Platform Workflows    │        │        │ CP Roles               ││ Platform Data         │        │        │ CP Permissions         ││ Platform Governance   │        │        │ CP Workflows           ││ Platform APIs         │        │        │ CP Data                ││ Platform Sessions     │        │        │ CP Governance          ││                       │        │        │ CP APIs                 │└───────────────────────┘        │        └────────────────────────┘          │                      │                     │          └──────── explicit integration contracts ───┘
    
Neither product SHALL be architecturally subordinate to the other.
    

    
    
    
5. PRODUCT BOUNDARY RULE
    
The following shall become a mandatory Competen engineering rule:
    
No Competen product may create, infer, assign, modify, suspend or revoke membership, roles, permissions or product-owned business data within another Competen product except through an explicitly approved cross-product integration contract.
    
Accordingly:
    
CompetenPractice SHALL NOT:
    
create a Competen Platform user;
    
assign a Platform Nurse role;
    
assign a Platform Doctor role;
    
assign a facility membership;
    
provision Platform permissions;
    
modify Platform governance records;
    
or automatically provide Platform access.
    
Competen Platform SHALL NOT:
    
create a CompetenPractice practitioner membership;
    
create a practice;
    
automatically assign Practice Owner;
    
automatically activate CompetenPractice;
    
or modify CompetenPractice permissions.
    
Cross-product activity MUST be deliberate, traceable and governed.
    

    
    
    
6. SHARED IDENTITY ARCHITECTURE
    
Competen MAY maintain a common identity service.
    
Its purpose is limited to establishing the identity and security of a person.
    
Example:
    
Competen Identity-----------------identity_idemailphoneauthentication credentialsverified email statusverified phone statusMFA configurationsecurity stateaccount recovery stateglobal security flags
    
The Identity Service MAY answer questions such as:
    
Is this credential valid?
    
Is the email verified?
    
Is MFA required?
    
Is this identity globally suspended for security reasons?
    
What identity ID corresponds to this authentication event?
    
The Identity Service SHALL NOT determine:
    
whether the user belongs to Competen Platform;
    
whether the user belongs to CompetenPractice;
    
whether the person is a nurse;
    
whether the person is a Practice Owner;
    
whether the person belongs to a particular facility;
    
whether the person may access particular patient records.
    
Those decisions belong to product-specific authorization systems.
    

    
    
    
7. PRODUCT MEMBERSHIP
    
Product membership SHALL be explicit.
    
A conceptual model is:
    
identity    │    ├── platform_memberships    │    └── practice_memberships
    
The absence of a membership means the identity has no access to that product.
    
Example:
    
Identity: Mullen E.Platform Membership:NONECompetenPractice Membership:ACTIVEPractice:Mullen E.'s PracticeRole:Practitioner
    
This is a valid state.
    
There SHALL be no requirement that Mullen E. first receive a Competen Platform account.
    

    
    
    
8. PROFESSION MUST BE SEPARATED FROM AUTHORIZATION
    
Professional identity and application permissions MUST NOT be conflated.
    
For example:
    
Profession:Nurse
    
is a professional/profile characteristic.
    
It DOES NOT mean:
    
Platform Role:Nurse
    
A CompetenPractice practitioner may professionally be:
    
a doctor;
    
nurse;
    
dentist;
    
pharmacist;
    
physiotherapist;
    
psychologist;
    
nutritionist;
    
clinical officer;
    
occupational therapist;
    
or another supported health professional.
    
Within CompetenPractice, their application role may simply be:
    
Practitioner
    
Professional discipline SHALL therefore be modelled separately from product authorization.
    

    
    
    
9. COMPETEN PLATFORM AUTHORIZATION DOMAIN
    
Competen Platform SHALL own its authorization domain.
    
Illustrative entities include:
    
platform_usersplatform_membershipsplatform_rolesplatform_permissionsplatform_role_permissionsfacility_membershipsplatform_access_policies
    
Possible roles may include:
    
Nurse;
    
Doctor;
    
Facility Administrator;
    
Department Administrator;
    
Platform Administrator;
    
Governance roles;
    
other facility or platform-specific roles.
    
These roles SHALL have no automatic meaning inside CompetenPractice.
    

    
    
    
10. COMPETENPRACTICE AUTHORIZATION DOMAIN
    
CompetenPractice SHALL maintain a completely independent authorization model.
    
Illustrative entities include:
    
practicespractice_accountspractice_membershipspractice_rolespractice_permissionspractice_role_permissionspractitioner_profilespractice_team_memberships
    
Possible CompetenPractice roles may include:
    
Practitioner;
    
Practice Owner;
    
Practice Administrator;
    
Practice Assistant;
    
Reception/Booking Assistant;
    
other configurable practice roles.
    
These roles SHALL have no automatic meaning inside Competen Platform.
    

    
    
    
11. COMPETENPRACTICE REGISTRATION
    
Registration into CompetenPractice SHALL follow a CompetenPractice-only provisioning flow.
    
The required conceptual flow is:
    
User enters CompetenPractice        ↓Create or resolve Competen Identity        ↓Verify identity        ↓Create CompetenPractice account        ↓Create or join Practice        ↓Create Practice Membership        ↓Assign CompetenPractice Role        ↓Create Practitioner/Profile record        ↓Enter CompetenPractice
    
The following MUST NOT occur:
    
Create Competen Platform UserAssign Platform NurseAssign Platform DoctorAssign Facility RoleProvision Platform Membership
    
unless a separate, explicitly initiated Competen Platform workflow is performed.
    

    
    
    
12. AUTHENTICATION GATE SEPARATION
    
The two products SHALL have distinct application entry gates.
    
    
Competen Platform
    
Example:
    
competенhealthcare.com/login
    
or:
    
platform.competenhealthcare.com
    
    
    
CompetenPractice
    
Example:
    
competенhealthcare.com/practice
    
or a future dedicated product host if required.
    
The exact domain structure may evolve, but the logical application boundaries SHALL remain separate.
    

    
    
    
    
13. SESSION AND TOKEN ISOLATION
    
Authentication sessions MUST be product-aware.
    
A CompetenPractice session SHALL identify CompetenPractice as its intended application audience.
    
Conceptually:
    
audience = competen-practice
    
A Competen Platform session:
    
audience = competen-platform
    
A token/session issued for CompetenPractice MUST NOT be accepted automatically by Competen Platform APIs.
    
Likewise, a Platform token/session MUST NOT automatically authorize CompetenPractice APIs.
    
If shared authentication or Single Sign-On is introduced later, it may reduce the need to authenticate twice, but it SHALL NOT remove the requirement for separate product authorization.
    
Therefore:
    
Single Sign-On may share authentication convenience. It must never imply Single Authorization.
    

    
    
    
14. NO AUTOMATIC CROSS-PRODUCT ACCESS
    
CompetenPractice menus, navigation and permissions SHALL remain within the Practice product.
    
A CompetenPractice user SHALL NOT see Competen Platform functionality merely because both applications belong to Competen.
    
Similarly, Platform navigation SHALL NOT expose CompetenPractice functionality unless the user separately possesses a valid CompetenPractice membership.
    
Where product switching is eventually provided, the product switcher MUST check membership independently.
    
Example:
    
My Competen ProductsCompetenPractice       OPENCompeten Platform      NO ACCESS
    
The absence of Platform membership SHALL not trigger automatic provisioning.
    

    
    
    
15. PRODUCT-OWNED DATA
    
Every business object SHALL have a defined product owner.
    
Competen Platform and CompetenPractice SHALL not automatically share tables merely because similar domain terms are used.
    
For example:
    
COMPETEN PLATFORM-----------------platform_patientplatform_encounterplatform_facilityplatform_clinicianplatform_episode
    
and:
    
COMPETENPRACTICE----------------practice_patientpractice_encounterpracticepractitioner_profilepractice_appointmentpractice_documentpractice_followup
    
Physical storage architecture may use shared infrastructure where technically appropriate, but logical ownership and access boundaries MUST remain explicit.
    

    
    
    
16. SHARED DATABASE INFRASTRUCTURE
    
A hard product split does not necessarily require separate database servers.
    
The system MAY use common infrastructure while enforcing clear logical separation.
    
Permitted approaches may include:
    
separate databases;
    
separate schemas;
    
separate services;
    
tenant/product partitioning;
    
separate access credentials;
    
or combinations of these.
    
The minimum requirement is:
    
A CompetenPractice service SHALL NOT have unrestricted access to Competen Platform-owned data, and vice versa.
    
Service credentials, database permissions and application interfaces SHOULD reinforce the product boundary.
    

    
    
    
17. SHARED CORE SERVICES
    
Competen SHALL maintain a registry of approved shared services.
    
Examples may include:
    
    
Identity
    
authentication;
    
MFA;
    
password management;
    
email verification;
    
account recovery.
    
    
    
Communication
    
email;
    
SMS;
    
WhatsApp;
    
push notifications;
    
notification templates.
    
    
    
Security
    
secrets management;
    
threat monitoring;
    
encryption services;
    
security events.
    
    
    
Audit
    
centralized audit transport;
    
immutable security events;
    
system activity records.
    
    
    
Billing
    
payment infrastructure;
    
subscription collection;
    
invoices;
    
receipts.
    
    
    
Infrastructure
    
hosting;
    
networking;
    
storage;
    
backups;
    
observability;
    
logging;
    
monitoring.
    
    
    
Integration
    
API gateway;
    
event infrastructure;
    
integration registry;
    
external service connectors.
    
These services SHALL provide capabilities.
    
They SHALL NOT own product-specific business authorization.
    

    
    
    
    
18. SHARED SERVICE DESIGN RULE
    
A shared service SHOULD operate using product-neutral instructions.
    
For example, the Notification Service may receive:
    
product = competen-practicerecipient = <identity/contact>template = appointment_confirmationchannel = email
    
The notification system delivers the communication.
    
It SHALL NOT determine whether the user is a nurse, practitioner, facility administrator or Practice Owner.
    
Authorization remains within the calling product.
    

    
    
    
19. CROSS-PRODUCT INTEGRATION
    
There may eventually be legitimate reasons for Competen Platform and CompetenPractice to exchange information.
    
Such sharing MUST occur only through defined contracts.
    
Approved patterns may include:
    
authenticated APIs;
    
integration services;
    
governed event buses;
    
synchronization services;
    
explicit import/export;
    
consent-controlled exchange;
    
interoperability standards.
    
Direct hidden database coupling SHOULD be prohibited.
    
Conceptually:
    
COMPETENPRACTICE       │       ▼Approved Integration Contract       │       ▼Integration Layer       │       ▼COMPETEN PLATFORM
    
Each integration SHALL define:
    
source product;
    
destination product;
    
data exchanged;
    
lawful/authorized purpose;
    
triggering event;
    
direction of exchange;
    
user consent requirements where applicable;
    
data ownership;
    
conflict rules;
    
audit requirements;
    
failure handling;
    
security controls;
    
revocation behaviour.
    

    
    
    
20. CROSS-PRODUCT PATIENT MATCHING
    
A shared individual may exist in both products without the records automatically becoming one record.
    
For example:
    
CompetenPractice Patient Record              │        potential match              │              ▼Competen Platform Patient Record
    
Any future matching architecture SHOULD use explicit identity/matching mechanisms and governance.
    
A matching identifier SHALL NOT, by itself, grant cross-product access to clinical information.
    
Identity linkage and data authorization are separate concerns.
    

    
    
    
21. INDEPENDENT PRODUCT LIFECYCLES
    
Each product SHALL be capable of independent:
    
deployment;
    
release management;
    
maintenance;
    
feature activation;
    
configuration;
    
scaling;
    
suspension;
    
commercialisation;
    
pricing;
    
governance;
    
versioning.
    
A Competen Platform deployment SHOULD NOT inherently require deployment of CompetenPractice.
    
A CompetenPractice release SHOULD NOT depend on enabling Platform functionality except where an explicitly declared shared dependency exists.
    

    
    
    
22. INDEPENDENT COMMERCIAL MODELS
    
The product boundary SHALL also apply commercially.
    
CompetenPractice may independently define:
    
trials;
    
subscriptions;
    
practitioner plans;
    
premium AI;
    
early-access pricing;
    
billing periods;
    
practice-level subscriptions.
    
Competen Platform may maintain entirely different commercial arrangements.
    
Purchasing one product SHALL NOT imply entitlement to another unless a bundled commercial product is deliberately introduced.
    
Entitlement MUST still be provisioned separately for each product.
    

    
    
    
23. INDEPENDENT GOVERNANCE
    
Competen Platform governance SHALL not automatically become CompetenPractice governance.
    
CompetenPractice SHALL define the authorities required to govern:
    
practice accounts;
    
practitioners;
    
practices;
    
subscriptions;
    
booking configuration;
    
product support;
    
safety configuration;
    
product operations.
    
Competen ecosystem administrators may have cross-product administrative capabilities only where explicitly granted through a separate governance mechanism.
    
Such privileged access MUST be highly controlled and audited.
    

    
    
    
24. ECOSYSTEM ADMINISTRATION
    
A future Competen ecosystem administration layer MAY exist above individual products.
    
It may manage matters such as:
    
product registry;
    
shared service registry;
    
system-wide identity security;
    
product activation;
    
infrastructure;
    
product health;
    
ecosystem billing configuration;
    
integration policies.
    
However, ecosystem administration SHALL NOT turn the individual products back into one authorization domain.
    
The conceptual hierarchy is:
    
COMPETEN ECOSYSTEM GOVERNANCE        │        ├── Competen Platform Governance        │        └── CompetenPractice Governance
    
The ecosystem governs products.
    
It does not make the products the same application.
    

    
    
    
25. PRODUCT REGISTRY
    
The architecture SHOULD introduce a formal Product Registry.
    
Example:
    
product_idproduct_codeproduct_namestatusauthentication_audiencebase_urlownerauthorization_domaindata_domainenabled_shared_servicesintegration_contracts
    
Example entries:
    
CP_PLATFORMCompeten PlatformCP_PRACTICECompetenPractice
    
Future products may be added without altering the fundamental product separation architecture.
    

    
    
    
26. SHARED CAPABILITY REGISTRY
    
A Shared Capability Registry SHOULD identify which ecosystem capabilities are available to which products.
    
Example:
    
Capability
Platform
Practice
Identity
Yes
Yes
Email
Yes
Yes
SMS
Configurable
Configurable
OTP
Yes
Yes
Audit
Yes
Yes
Billing
Configurable
Yes
File Storage
Yes
Yes
AI Infrastructure
Configurable
Configurable
Integration Gateway
Yes
Yes
    
The registry defines service availability.
    
It DOES NOT define user authorization.
    

    
    
    
27. PRACTICE CREATION
    
A new CompetenPractice practitioner onboarding into their own practice may trigger:
    
Create Identity        ↓Create CP Account        ↓Create Practice        ↓Generate Practice Identifier        ↓Create Practitioner Profile        ↓Create Practice Membership        ↓Assign Practice Owner / Practitioner        ↓Provision CP defaults        ↓Enter Practice
    
This workflow SHALL remain entirely inside CompetenPractice and approved shared services.
    
No Competen Platform facility, account or clinical role shall be generated.
    

    
    
    
28. PRACTICE TEAM MEMBERS
    
The same principle applies when a practitioner adds assistants or team members.
    
Adding:
    
Mary – Reception Assistant
    
to a practice SHALL create only the required CompetenPractice membership.
    
It SHALL NOT create:
    
a Platform employee;
    
facility membership;
    
hospital role;
    
Platform receptionist account;
    
or any other Gate 1 access.
    

    
    
    
29. DUAL-PRODUCT USERS
    
A person may legitimately belong to both applications.
    
Example:
    
Identity: Mullen E.Product Membership 1:CompetenPracticePractice: Mullen E.'s PracticeRole: PractitionerProduct Membership 2:Competen PlatformFacility: Hospital ARole: Nurse
    
These memberships MUST remain independent.
    
Actions in one product MUST NOT unintentionally alter the other.
    
Examples:
    
removing Mullen from Hospital A SHALL NOT remove her practice;
    
cancelling her Practice subscription SHALL NOT remove Hospital A access;
    
changing her Practice role SHALL NOT change her Platform Nurse role;
    
leaving the hospital SHALL NOT delete her CompetenPractice account.
    
Only global identity/security actions may intentionally affect authentication across products.
    

    
    
    
30. ACCOUNT DELETION AND SUSPENSION
    
The system SHALL distinguish:
    
    
Identity suspension
    
May prevent authentication to all products where required for serious security reasons.
    
    
    
Product membership suspension
    
Affects only the relevant product.
    
    
    
Practice membership removal
    
Affects only membership in the specified practice.
    
    
    
Platform facility membership removal
    
Affects only the specified Platform facility relationship.
    
    
    
Product deletion
    
Must follow product-specific retention and governance rules.
    
Deletion SHALL not cascade across product boundaries unless an explicitly defined policy requires it.
    

    
    
    
    
31. MULLEN E. CORRECTIVE MIGRATION
    
The current Mullen E. case demonstrates the previous architectural defect.
    
The intended state is:
    
Competen Identity:ACTIVECompeten Platform Membership:NONECompeten Platform Role:NONECompeten Platform Facility:NONECompetenPractice Account:ACTIVECompetenPractice Membership:ACTIVERole:PRACTITIONERPractice:Mullen E.'s Practice
    
The migration SHALL:
    
identify the underlying shared identity;
    
retain the identity;
    
retain the CompetenPractice account;
    
retain the CompetenPractice practitioner profile;
    
retain the practice;
    
retain Practice membership;
    
remove the accidentally created Platform Nurse membership;
    
remove Platform permissions arising solely from that erroneous provisioning;
    
preserve unrelated records only where there is a lawful and valid reason to do so;
    
verify Gate 1 access is denied;
    
verify Gate 2 remains fully functional;
    
write an audit record documenting the corrective action.
    
The migration MUST NOT delete the CompetenPractice identity relationship merely to remove the erroneous Platform role.
    

    
    
    
32. API BOUNDARIES
    
APIs SHOULD be clearly namespaced by product.
    
For example:
    
/api/platform/...
    
and:
    
/api/practice/...
    
or separate service hosts:
    
platform-api.competenhealthcare.compractice-api.competenhealthcare.com
    
Shared services may use:
    
identity-api...notifications-api...billing-api...integration-api...
    
Product APIs MUST validate:
    
product audience;
    
product membership;
    
relevant role;
    
permission;
    
tenant/practice/facility context;
    
resource ownership.
    

    
    
    
33. SERVICE CREDENTIAL BOUNDARIES
    
CompetenPractice backend services SHOULD use credentials that allow access only to:
    
CompetenPractice-owned services/data;
    
approved shared services;
    
approved integration endpoints.
    
Competen Platform services SHOULD have equivalent restrictions.
    
A compromised Practice service SHOULD NOT inherently provide unrestricted access to Platform databases.
    
This principle is part of defence in depth.
    

    
    
    
34. CONFIGURATION BOUNDARY
    
Each product SHALL maintain product-specific configuration.
    
For example:
    
platform_configuration
    
and:
    
practice_configuration
    
A common configuration engine MAY underpin both products.
    
However, configuration data SHALL remain scoped by product.
    
CompetenPractice settings MUST NOT unexpectedly change Platform behaviour.
    

    
    
    
35. AUDIT BOUNDARY
    
A centralized audit infrastructure MAY be shared.
    
Every event MUST carry relevant context such as:
    
product_ididentity_idmembership_idtenant/practice/facility_idactionresourcetimestampcorrelation_id
    
This allows ecosystem-wide security investigation while maintaining clear product ownership.
    

    
    
    
36. OBSERVABILITY
    
Infrastructure monitoring may span the ecosystem.
    
However dashboards SHOULD be capable of separating:
    
Competen Platform health;
    
CompetenPractice health;
    
shared-service health;
    
cross-product integration health.
    
A failure in one product SHOULD be identifiable without treating the entire ecosystem as one application failure.
    

    
    
    
37. FAILURE ISOLATION
    
Where feasible, architecture SHALL ensure that failure of one product does not unnecessarily incapacitate another.
    
For example:
    
If Competen Platform encounters a workflow failure, CompetenPractice booking should continue where its own dependencies remain operational.
    
Shared-service failures may affect multiple products, but such dependencies SHALL be clearly documented.
    

    
    
    
38. DATA EXPORT AND PORTABILITY
    
Each product SHALL own its data export responsibilities.
    
A CompetenPractice user requesting an export SHOULD receive CompetenPractice-owned data they are entitled to access.
    
This SHALL NOT automatically include Competen Platform data simply because the same global identity exists there.
    

    
    
    
39. FUTURE PRODUCT ADDITION
    
This architecture intentionally supports additional Competen products.
    
Future applications SHALL follow:
    
Competen Ecosystem      │      ├── Competen Platform      ├── CompetenPractice      ├── Future Product A      ├── Future Product B      └── Shared Core Services
    
No future product should require architectural insertion inside Competen Platform merely because Platform existed first.
    

    
    
    
40. DEVELOPMENT RULE: NO IMPLICIT PROVISIONING
    
Developers MUST NOT write logic equivalent to:
    
If user signs up for a Competen healthcare product:    Create Platform account
    
or:
    
If profession = nurse:    Assign Platform Nurse role
    
or:
    
If user has identity:    Grant access to all Competen applications
    
Such behaviour violates this architecture.
    
All product memberships require an explicit product-specific provisioning event.
    

    
    
    
41. REQUIRED SECURITY TESTS
    
Automated security and integration tests SHALL include at minimum:
    
    
Test A
    
A CompetenPractice-only practitioner attempts to open Competen Platform.
    
Expected:
    
ACCESS DENIED
    
No Platform membership is created.
    
    
    
Test B
    
A Platform-only nurse attempts to open CompetenPractice.
    
Expected:
    
ACCESS DENIED / PRODUCT REGISTRATION REQUIRED
    
No Practice is automatically created.
    
    
    
Test C
    
A dual-product user enters CompetenPractice.
    
Expected:
    
Only Practice permissions apply.
    
    
    
Test D
    
The same dual-product user enters Platform.
    
Expected:
    
Only Platform permissions apply.
    
    
    
Test E
    
Practice membership is revoked.
    
Expected:
    
Platform membership remains unchanged.
    
    
    
Test F
    
Platform membership is revoked.
    
Expected:
    
Practice membership remains unchanged.
    
    
    
Test G
    
Profession is changed.
    
Expected:
    
No product role is automatically created or changed unless explicit rules inside that product authorize such action.
    

    
    
    
    
42. REQUIRED DEVELOPER MIGRATION REVIEW
    
The development team SHALL search the existing codebase for any assumptions that:
    
CompetenPractice is a Platform module;
    
all Competen users require Platform users;
    
practitioner profession maps directly to Platform roles;
    
CP provisioning creates Platform records;
    
Platform membership is required before Practice membership;
    
Platform RBAC controls Practice access;
    
Platform tenant IDs are automatically reused as Practice IDs;
    
Practice data is stored as Platform data without a product boundary;
    
Platform logout/session rules implicitly control Practice without product context.
    
Each dependency SHALL be:
    
removed;
    
isolated;
    
or explicitly justified as an approved shared service.
    

    
    
    
43. PREVIOUS DOCUMENT SUPERSESSION
    
Any previous architecture, capability, governance, provisioning or routing specification that treats CompetenPractice as:
    
a module of Competen Platform;
    
a Platform workspace;
    
a Platform tenant;
    
a Platform clinical role;
    
or an automatically provisioned extension of a Platform user
    
is superseded by this document.
    
Previous specifications do not need to be discarded in full.
    
Reusable components may remain valid where they concern:
    
shared identity infrastructure;
    
notifications;
    
security;
    
communications;
    
billing engines;
    
integration frameworks;
    
hosting;
    
storage;
    
audit;
    
observability;
    
other explicitly shared infrastructure.
    
Their interpretation MUST be amended to comply with this Product Separation Architecture.
    

    
    
    
44. ARCHITECTURAL DECISION SUMMARY
    
The following decisions are now frozen:
    
Competen Platform and CompetenPractice are different products.
    
Neither product is subordinate to the other.
    
Each product has a separate entry gate.
    
Shared identity does not grant product membership.
    
Product memberships are independent.
    
Product authorization systems are independent.
    
Professional discipline is not equivalent to an application role.
    
CompetenPractice registration shall not provision Competen Platform.
    
Platform registration shall not automatically provision CompetenPractice.
    
A person may belong to one product, both products or neither.
    
Shared services may support both products without controlling their product-specific permissions.
    
Business data has explicit product ownership.
    
Cross-product exchange requires an explicit integration contract.
    
Product sessions/tokens must be product scoped.
    
Product removal or suspension does not automatically affect another product.
    
Future Competen products shall follow the same architecture.
    

    
    
    
45. FINAL REFERENCE MODEL
    
                         COMPETEN ECOSYSTEM                                │                                │                     ┌──────────┴──────────┐                     │                     │                     │    SHARED CORE      │                     │                     │                     │ Identity            │                     │ Security            │                     │ Communications      │                     │ Billing             │                     │ Audit               │                     │ Integration         │                     │ Infrastructure      │                     │                     │                     └──────┬───────┬──────┘                            │       │                ┌───────────┘       └────────────┐                │                                │                ▼                                ▼      ┌──────────────────────┐        ┌──────────────────────┐      │  COMPETEN PLATFORM   │        │  COMPETENPRACTICE    │      │                      │        │                      │      │       GATE 1         │        │       GATE 2         │      │                      │        │                      │      │ Membership A         │        │ Membership B         │      │ Authorization A      │        │ Authorization B      │      │ Data Domain A        │        │ Data Domain B        │      │ Workflow A           │        │ Workflow B           │      │ Governance A         │        │ Governance B         │      │ Session A            │        │ Session B            │      └──────────┬───────────┘        └──────────┬───────────┘                 │                               │                 └──── APPROVED INTEGRATIONS ────┘
    
    
    
46. GOVERNING STATEMENT
    
The Competen ecosystem is not a single application with CompetenPractice embedded inside it.
    
It is an ecosystem of independent products that may consume common services.
    
Competen Platform is one product.
    
CompetenPractice is another product.
    
The common Competen foundation provides shared capabilities where doing so is efficient, safe and strategically useful.
    
The products remain independently accessible, independently authorized, independently governed and independently evolvable.
    
The permanent architectural principle is:
    
Share the foundation where useful. Separate the gates, keys, rooms and ownership.
    
    
      
        
                
        
        
              
      
    
  

