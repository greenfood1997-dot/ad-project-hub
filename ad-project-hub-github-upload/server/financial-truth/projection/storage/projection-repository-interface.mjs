export const PROJECTION_REPOSITORY_INTERFACE=Object.freeze(["getCompanyProjection","getProjectProjection","saveCompanyProjection","saveProjectProjection"]);
export const PROJECTION_REPOSITORY_INTERFACE_CONTRACT=Object.freeze([
 Object.freeze({name:"getCompanyProjection",parameters:["txOrClient","companyId","currency"],returns:"Projection|null",semanticRole:"read company projection"}),
 Object.freeze({name:"getProjectProjection",parameters:["txOrClient","companyId","projectId","currency"],returns:"Projection|null",semanticRole:"read project projection"}),
 Object.freeze({name:"saveCompanyProjection",parameters:["tx","projection","expectedCurrentWatermark"],returns:"SAVED|SAME_STATE",semanticRole:"CAS company save"}),
 Object.freeze({name:"saveProjectProjection",parameters:["tx","projection","expectedCurrentWatermark"],returns:"SAVED|SAME_STATE",semanticRole:"CAS project save"})
]);
