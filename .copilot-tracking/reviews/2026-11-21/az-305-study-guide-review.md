# AZ-305 study-guide review

Reviewed on **2026-11-21** against the official English AZ-305 guide revision
dated **2026-10-30** and deck version **2026-03-23**
(`flashcards/az305_flashcards_2026-03-23.csv`, 99 cards).

The guide page is current rather than upcoming. It identifies skills measured
as of **2026-04-17**. The available official change log establishes only a
minor audience-profile change for that transition. It does not verify a domain,
skill, rewording, or published-weighting change on October 30.

The existing deck is retained. No cards were added, corrected, removed, or
regenerated because the October 30 page date alone does not justify deck
regeneration and no verified objective-level target change is available.

## Published objective ranges

| Domain | Published range |
| --- | --- |
| Identity governance, privacy, and monitoring | 25–30% |
| Design data storage solutions | 20–25% |
| Design business continuity solutions | 15–20% |
| Design infrastructure solutions | 30–35% |

These are reference ranges. Of the 99 cards, 22 have primary domain `Identity`
or `IdentityGovernance`, 20 have `DataStorage`, 9 have `BusinessContinuity`,
and 18 have `Infrastructure`: 69 cards total. The other 30 cards have
different primary domains. These are primary-domain counts, not counts of
every matching topic tag, and do not establish complete objective coverage.

## Current objective-to-card assessment

The current objective list below is from the official English guide, under
“Skills measured as of April 17, 2026.” Card references are one-based CSV data
row numbers (the header is not counted) for the exact deck version above.
“Partial” means the card is relevant but does not demonstrate every task nuance
in the objective. Each current skill was checked; objectives without a direct
card are called out explicitly.

| Official objective | Card rows | Assessment |
| --- | --- | --- |
| **Identity, governance, and monitoring (25–30%)** | | |
| Recommend a logging solution | 5, 15, 97 | Partial: log collection and archival are represented; coverage of the available logging services is not exhaustive. |
| Recommend a solution for routing logs | 17, 97 | Partial: regional workspace routing and archive destination are represented. |
| Recommend a monitoring solution | 6, 9, 20 | Partial: application tracing, service metrics, and VM monitoring are represented. |
| Recommend an authentication solution | 4, 16, 18, 91 | Partial: external identity, conditional access, workload identity, and risk-based access are represented. |
| Recommend an identity management solution | 1, 4 | Partial: tenant and customer identity-management scenarios are represented. |
| Recommend a solution for authorizing access to Azure resources | 8, 11, 13, 21 | Partial: scoped RBAC, delegated access, PIM, and approval scenarios are represented. |
| Recommend a solution for authorizing access to on-premises resources | — | Gap: no card directly tests authorization to on-premises resources. |
| Recommend a solution to manage secrets, certificates, and keys | 2, 14 | Partial: Key Vault secrets and managed keys are represented; certificate lifecycle is not explicit. |
| Recommend a structure for management groups, subscriptions, and resource groups, and a strategy for resource tagging | 7, 19, 98 | Partial: hierarchy, inherited tags, and cross-subscription organization are represented. |
| Recommend a solution for managing compliance | 3, 10, 89 | Partial: policy enforcement and compliance reporting are represented. |
| Recommend a solution for identity governance | 8, 21 | Partial: PIM activation, approvals, and access reviews are represented. |
| **Data storage (20–25%)** | | |
| Recommend a solution for storing relational data | 22, 23, 24, 25 | Partial: SQL, globally distributed relational data, analytics, and tenant-isolation patterns are represented. |
| Recommend a database service tier and compute tier | 24, 25, 39 | Partial: serverless, elastic pool, and query-workload scenarios are represented. |
| Recommend a solution for database scalability | 25, 38, 39 | Partial: elastic pools, Hyperscale, and serverless scaling are represented. |
| Recommend a solution for data protection | 37, 40 | Partial: database replication and storage redundancy are represented; database protection options are not exhaustive. |
| Recommend a solution for storing semi-structured data | 28, 30, 31, 36 | Partial: JSON, Parquet, and data-integration scenarios are represented. |
| Recommend a solution for storing unstructured data | 26, 27, 29, 30 | Partial: object storage, archival, analytics, and global delivery are represented. |
| Recommend a data storage solution to balance features, performance, and costs | 24, 26, 29, 38, 39, 82 | Partial: trade-offs across query, throughput, tiering, and cost are represented. |
| Recommend a data solution for protection and durability | 28, 37, 40, 90 | Partial: immutable storage, replication, and data protection scenarios are represented. |
| **Business continuity (15–20%)** | | |
| Recommend a recovery solution for Azure and hybrid workloads that meets recovery objectives | 40, 45, 48, 49 | Partial: regional redundancy and workload RPO/RTO scenarios are represented; hybrid workload recovery is not explicit. |
| Recommend a backup and recovery solution for compute | 47, 48 | Partial: VM backup and regional recovery are represented. |
| Recommend a backup and recovery solution for databases | 44, 45 | Partial: database restore and failover are represented; coverage across database services is limited. |
| Recommend a backup and recovery solution for unstructured data | 40, 46 | Partial: blob redundancy and Azure Files backup are represented. |
| Recommend a high availability solution for compute | 43, 48 | Partial: zone-resilient AKS and regional VM failover are represented. |
| Recommend a high availability solution for relational data | 42, 45 | Partial: zone redundancy and SQL auto-failover are represented. |
| Recommend a high availability solution for semi-structured and unstructured data | 40, 46, 49 | Partial: blob redundancy, file backup, and multi-region NoSQL availability are represented. |
| **Infrastructure (30–35%)** | | |
| Specify components of a compute solution based on workload requirements | 51, 52, 75, 76, 77, 78 | Partial: batch, HPC, network latency, GPU, disk, and dedicated-host needs are represented. |
| Recommend a virtual machine-based solution | 52, 54, 77, 78 | Partial: HPC, legacy OS, disk performance, and dedicated-host workloads are represented. |
| Recommend a container-based solution | 43, 53, 55 | Partial: AKS availability, short-lived tasks, and deployment patterns are represented. |
| Recommend a serverless-based solution | 53 | Partial: short-lived event-triggered compute is represented; broader serverless trade-offs are not. |
| Recommend a compute solution for batch processing | 51, 80 | Partial: scheduled batch and interruptible compute are represented. |
| Recommend a messaging architecture | 56 | Partial: asynchronous service communication is represented. |
| Recommend an event-driven architecture | 57, 96 | Partial: event notification and event-processing pipelines are represented. |
| Recommend a solution for API integration | — | Gap: no card directly tests API integration architecture selection. |
| Recommend a caching solution for applications | 58 | Partial: application response caching is represented. |
| Recommend an application configuration management solution | 59, 95 | Partial: centralized configuration and feature flags are represented. |
| Recommend an automated deployment solution for applications | 55, 60, 84 | Partial: blue/green deployment, multi-cluster delivery, and infrastructure deployment are represented. |
| Evaluate a migration solution that leverages the Microsoft Cloud Adoption Framework for Azure | 67, 68, 94 | Partial: migration strategy and modernization choices are represented; the Framework assessment is not explicit. |
| Evaluate on-premises servers, data, and applications for migration | 66, 67, 68 | Partial: database, server, and application migration scenarios are represented; assessment tooling is not explicit. |
| Recommend a solution for migrating workloads to IaaS and PaaS | 67, 68 | Partial: VM and application migration paths are represented. |
| Recommend a solution for migrating databases | 66, 68 | Partial: database migration with downtime constraints is represented. |
| Recommend a solution for migrating unstructured data | 68 | Partial: blob data is included in a multi-workload migration scenario, but no dedicated unstructured-data migration scenario exists. |
| Recommend a connectivity solution that connects Azure resources to the internet | 61, 71 | Partial: global ingress and controlled outbound connectivity are represented. |
| Recommend a connectivity solution that connects Azure resources to on-premises networks | 63, 72, 73 | Partial: private hybrid connectivity and multi-VNet topologies are represented. |
| Recommend a solution to optimize network performance | 62, 64, 75 | Partial: centralized routing, load balancing, and low-latency placement are represented. |
| Recommend a solution to optimize network security | 62, 65, 69, 74, 86 | Partial: firewalling, private endpoints, encryption, and WAF protection are represented. |
| Recommend a load-balancing and routing solution | 61, 64, 74 | Partial: global routing, zonal load balancing, and protected application ingress are represented. |

## Evidence and unresolved gaps

- Official guide:
  https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-305
- Official exam page and change log were identified in issue `#15`.
- The guide snapshot records page update `2026-10-30`, while independent
  `updated_at` metadata is later. Neither metadata timestamp nor a review date
  was substituted for the displayed page date.
- No official historical diff or complete predecessor sentence-level objective
  text was available. This is an evidence limitation, not proof that no change
  occurred.
- The current objective assessment is complete, but the listed partial areas
  and the two objectives with no direct card mean this deck is not labeled
  aligned.

The app therefore reports this as a completed review with coverage gaps, not
verified deck alignment.
