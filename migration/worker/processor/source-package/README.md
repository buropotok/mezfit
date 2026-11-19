# SourceImportPackage v1

The normative domain types are in docs/architecture/migration-source-contract.md.
`shape.ts` checks exact fields and scalar types; `validate.ts` checks the typed
reference graph, parent/subject isolation and required issues after extraction.
`isSourceImportPackage` validates structure, never publication permission.
`sourcePackageStatus` distinguishes invalid, valid and valid-with-issues.
Publishability is exclusively a future Business Mapping concern.

Bounds: input 8192 bytes, every ordinary collection 32 entries, attributes 16,
issues 256, keys 128 characters, text 1000, graph 512 entities, structural budget
4096 values and depth 12. Processor v3 output is at most 65536 UTF-8 bytes in
one private immutable R2 JSON object. No chunking or manifest is introduced.
Schemas 1/2 retain the 1024-byte bound and exact serialization. Processor v1,
D1 version and result/Workflow identities remain unchanged. The existing
conditional PUT, checksum, independent readback, replay and owned cleanup apply.
These deliberately small synthetic limits do not establish real archive support.

Synthetic training is a reviewed tuple source, not an echo of the output:
people[id,name]; exercises[id,name,load|duration|null]; templates[id,subject,
phases[id,name],days[id,phase,moves[id,definition,sets[id,reps,weight,unit]]]];
appointments[id,subject,program,day,date,plan]; history[id,subject,program,
appointment,date,frozenPlan,performed[id,definition,sets[id,planSet,metrics]]].
Plan entries are [id,definition,programExercise,sets[id,programSet,metrics]].
Metrics are [reps,weight,weightUnit,duration,durationUnit,distance,distanceUnit].
History rows explicitly represent completed source workouts. Keys are globally
unique per entity type in this synthetic format. Null references mean proven none; '?' means unknown. An absent plan is null;
'?' means unknown snapshot. Source numbers in templates become typed attributes
and issues, never PLAN. Measures are omitted with an explicit count.
Names/keys/attributes remain only in private R2; telemetry uses codes/counts.
