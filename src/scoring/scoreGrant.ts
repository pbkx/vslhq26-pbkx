import type {GrantOpportunity,GrantResult,HistoricalEvidence,MatchWeights,OrganizationProfile,ProjectProfile,ScoreComponent,ScoreEvidence} from "../domain/types.js";
import {DEFAULT_WEIGHTS} from "../domain/types.js";
const synonymGroups=[
 ["workforce development","workforce training","job training","career readiness","employment training","skills development","economic mobility","career pathways","upskilling","reskilling"],
 ["digital inclusion","digital equity","digital access","technology access","digital navigation","digital divide"],
 ["artificial intelligence","ai","ai literacy","machine learning","responsible ai"],
 ["adult education","adult learning","community learning","continuing education"],
 ["low income","low-income","economically disadvantaged","underserved"],
];
const words=(value:string)=>value.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(x=>x.length>2&&!["and","the","for","with","from"].includes(x));
const expand=(terms:string[])=>{
 const normalized=terms.map(term=>term.toLowerCase());
 const related=synonymGroups.filter(group=>group.some(alias=>normalized.some(term=>term.includes(alias))));
 return new Set([...terms,...related.flat()].flatMap(words));
};
const overlap=(a:string[],b:string[])=>{const left=expand(a),right=expand(b);if(!left.size||!right.size)return 50;return Math.round(100*[...left].filter(x=>right.has(x)).length/Math.min(left.size,right.size))};
const conceptPatterns:[string,RegExp][]=[
 ["AI and digital skills",/\b(artificial intelligence|ai|machine learning|responsible ai|ai literacy|digital skills?|digital literacy|technology training)\b/i],
 ["workforce and careers",/\b(workforce|employment training|job training|career pathways?|career readiness|economic mobility|upskilling|reskilling|job placement)\b/i],
 ["adult learning",/\b(adult education|adult learning|adult learners?|continuing education)\b/i],
 ["economic inclusion",/\b(low-income|low income|underserved|disadvantaged|digital inclusion|digital equity|economic opportunity)\b/i],
];
const concepts=(values:string[])=>new Set(conceptPatterns.filter(([,pattern])=>pattern.test(values.join(" "))).map(([name])=>name));
const conceptCoverage=(project:Set<string>,opportunity:Set<string>)=>project.size?100*[...project].filter(value=>opportunity.has(value)).length/project.size:50;
const sectorPatterns:[string,RegExp][]=[
 ["agriculture or food systems",/\b(agriculture|agricultural|food sciences?|farming|crop|livestock)\b/i],
 ["clinical or health research",/\b(clinical|biomedical|medical research|health research|disease|cancer|hiv|patient care|family planning)\b/i],
 ["defense or military research",/\b(naval|military|department of defen[cs]e|dod|defen[cs]e research|warfighting|army research|air force research)\b/i],
 ["international public diplomacy",/\b(embassy|u\.?s\.? mission|public diplomacy|foreign affairs|international exchange|egypt|philippines|algeria|lebanon|vietnam|uganda|south asia|ukraine|syria)\b/i],
 ["institution-led academic research",/\b(research center|research grants?|clinical trials?| r01 | p30 |higher education research)\b/i],
];
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const component=(score:number,weight:number,confidence:number,reasons:string[],evidence:ScoreEvidence[],missingData:string[]):ScoreComponent=>({score:clamp(score),weight,weightedContribution:clamp(score)*weight,confidence,reasons,evidence,missingData});
export function validateWeights(weights:MatchWeights){const sum=Object.values(weights).reduce((a,b)=>a+b,0);if(Math.abs(sum-1)>.001)throw new Error(`Scoring weights must total 1.0; received ${sum.toFixed(3)}.`)}
export function daysUntil(deadline?:string){return deadline?Math.ceil((Date.parse(deadline)-Date.now())/86400000):undefined}
export function applicationEffort(grant:GrantOpportunity,org:OrganizationProfile){let value=20;if(grant.requiresCostShare)value+=15;if(grant.requirements.some(r=>r.category==="partnership"))value+=15;if(grant.requirements.some(r=>r.category==="registration")&&org.registrations?.samGov!=="active")value+=10;if(grant.requirements.some(r=>r.text.toLowerCase().includes("two-stage")))value+=10;value+=Math.min(20,grant.requirements.filter(r=>r.category==="program").length*5);value+=Math.min(15,grant.requirements.filter(r=>r.category==="document").length*3);if((daysUntil(grant.deadline)??1000)<30)value+=10;return clamp(value)}
const deadlineScore=(days:number|undefined,capacity= "medium")=>{if(days===undefined)return 60;if(days<=0)return 0;const table=capacity==="low"?[[90,100],[61,85],[31,55],[15,20],[1,5]]:capacity==="high"?[[90,100],[61,100],[31,95],[15,80],[1,50]]:[[90,100],[61,95],[31,80],[15,50],[1,20]];return table.find(([minimum])=>days>=minimum)?.[1]??0};
export function scoreGrant(grant:GrantOpportunity,org:OrganizationProfile,project:ProjectProfile,historical:HistoricalEvidence,weights:MatchWeights=DEFAULT_WEIGHTS):GrantResult{
 validateWeights(weights);const privateProspect=grant.recordCategory==="private-funder-prospect";const evidence=(source:ScoreEvidence["source"],field:string,value:ScoreEvidence["value"]):ScoreEvidence=>({source,field,value,sourceUrl:source==="opportunity"?grant.sourceUrl:undefined});
 const topic=overlap(project.topics,grant.missionTopics),mission=overlap(org.missionTopics,grant.missionTopics),population=overlap(project.targetPopulations,grant.populationsServed),text=overlap([...project.topics,...words(project.summary)],[...grant.missionTopics,...words(`${grant.title} ${grant.summary}`)]);
 const projectConcepts=concepts([...project.topics,project.summary,...project.targetPopulations,...org.missionTopics]);
 const grantConcepts=concepts([grant.title,grant.summary,...grant.missionTopics,...grant.populationsServed]);
 const coverage=conceptCoverage(projectConcepts,grantConcepts);
 const projectText=[project.title,project.summary,...project.topics,...org.missionTopics].join(" ");
 const grantText=[grant.title,grant.summary,grant.funderName,...grant.missionTopics].join(" ");
 const sectorMismatches=sectorPatterns.filter(([,pattern])=>pattern.test(grantText)&&!pattern.test(projectText)).map(([name])=>name);
 const sectorPenalty=Math.min(44,sectorMismatches.length*22);
 const missionScore=clamp(topic*.20+mission*.10+population*.15+text*.10+coverage*.45-sectorPenalty);
 const applicantText=grant.eligibleApplicantTypes.join(" ").toLowerCase(),orgType=org.organizationType.toLowerCase();
 const applicantSupported=applicantText.includes(orgType)||applicantText.includes("501")||applicantText.includes("unrestricted");
 const applicantUncertain=!applicantText||applicantText.includes("other applicants")||applicantText.includes("review the additional");
 const explicitlyExcluded=!privateProspect&&!applicantSupported&&!applicantUncertain;
 const applicantScore=privateProspect?50:explicitlyExcluded?0:applicantSupported?100:50;
 const projectStates=project.geographicAreas.flatMap(x=>x.states??[]),eligibleStates=grant.eligibleLocations.flatMap(x=>x.states??[]),nationwide=grant.eligibleLocations.some(x=>x.nationwide);
 const historicalStateMatch=projectStates.some(x=>eligibleStates.includes(x));
 const geoScore=privateProspect?(historicalStateMatch?85:eligibleStates.length?45:50):nationwide?90:historicalStateMatch?100:eligibleStates.length?0:50;
 const budget=project.estimatedBudget,min=grant.awardMin,max=grant.awardMax;let sizeScore=60;if(budget!==undefined&&(min!==undefined||max!==undefined)){if((min===undefined||budget>=min)&&(max===undefined||budget<=max))sizeScore=100;else{const boundary=budget<(min??0)?min!:max!;sizeScore=clamp(100-Math.abs(budget-boundary)/boundary*100)}}
 const days=daysUntil(grant.deadline);let deadline=privateProspect?50:deadlineScore(days,org.applicationCapacity);if(grant.requiresCostShare)deadline-=10;if(grant.requirements.some(r=>r.category==="partnership"))deadline-=10;if(grant.requirements.some(r=>r.category==="registration")&&org.registrations?.samGov!=="active")deadline-=10;
 const components={
  missionAlignment:component(missionScore,weights.missionAlignment,90,[`${Math.round(coverage)}% coverage across the project's AI/digital, workforce, adult-learning, and economic-inclusion concepts.`,`${Math.round(topic)}% project-topic overlap with the opportunity.`,...(sectorMismatches.length?[`Potential sector mismatch: ${sectorMismatches.join(", ")}.`]:[])],[evidence("project","topics",project.topics.join(", ")),evidence("opportunity","missionTopics",grant.missionTopics.join(", "))],[]),
  applicantEligibility:component(applicantScore,weights.applicantEligibility,privateProspect?25:grant.eligibleApplicantTypes.length?95:45,[privateProspect?"Historical IRS giving does not establish current applicant eligibility.":explicitlyExcluded?"Applicant type conflicts with the stated eligible categories.":"Nonprofit applicant type is supported or not explicitly excluded."],[evidence("organization","organizationType",org.organizationType),evidence("opportunity","eligibleApplicantTypes",grant.eligibleApplicantTypes.join(", "))],privateProspect?["Current application eligibility is unknown."]:grant.eligibleApplicantTypes.length?[]:["Detailed applicant categories are missing."]),
  geographicFit:component(
   geoScore,weights.geographicFit,
   privateProspect?(eligibleStates.length?55:25):eligibleStates.length||nationwide?95:40,
   [privateProspect
    ?historicalStateMatch?"Historical IRS records include giving to the project's state; this is not a current eligibility rule.":"Historical recipient geography does not establish current geographic eligibility."
    :geoScore>=90?"Washington project geography is supported.":"Geographic eligibility needs review."],
   [evidence("project","geography",projectStates.join(", ")),evidence("opportunity","eligibleLocations",eligibleStates.join(", ")||"Not specified")],
   privateProspect?["Current geographic eligibility is unknown."]:eligibleStates.length||nationwide?[]:["Eligible states were not specified."]
  ),
  programSizeFit:component(sizeScore,weights.programSizeFit,min!==undefined||max!==undefined?90:40,[sizeScore===100?"Project budget falls inside the stated award range.":"Project budget differs from the stated or known range."],[evidence("project","estimatedBudget",budget??"Unknown"),evidence("opportunity","awardRange",`${min??"?"}-${max??"?"}`)],min!==undefined||max!==undefined?[]:["No complete award range was supplied."]),
  historicalSimilarity:component(historical.score,weights.historicalSimilarity,historical.confidence,historical.reasons,[evidence("historical-award","comparableAwards",historical.awardCount)],historical.confidence?[]:["Historical award data was unavailable."]),
  deadlineFeasibility:component(deadline,weights.deadlineFeasibility,privateProspect?15:grant.deadline?95:35,[privateProspect?"IRS history does not establish a current application deadline.":days===undefined?"Deadline was not supplied.":`${days} days remain at ${org.applicationCapacity??"medium"} application capacity.`],[evidence("opportunity","deadline",grant.deadline??"Unknown"),evidence("organization","applicationCapacity",org.applicationCapacity??"medium")],grant.deadline?[]:["Deadline is unknown."])
 };
 const overallScore=Object.values(components).reduce((sum,c)=>sum+c.weightedContribution,0);const hardExclusions=explicitlyExcluded?["The opportunity explicitly limits applicants to a different organization type."]:!privateProspect&&geoScore===0?["Project geography appears outside the stated eligible area."]:[];
 const confidence=Math.round(Object.values(components).reduce((s,c)=>s+c.confidence,0)/6);const status=privateProspect?"needs-verification":hardExclusions.length?"likely-ineligible":applicantScore===100&&geoScore>=90&&confidence>=85?"confirmed":overallScore>=75?"likely":overallScore>=60?"possible":confidence<60?"needs-verification":"possible";
 const warnings=[...(privateProspect?[grant.sourceDisclaimer]:[]),...(grant.requiresCostShare&&org.canProvideCostShare===false?["Cost share is required, but the organization indicated it cannot provide matching funds."]:[]),...(budget&&org.annualBudget&&budget>org.annualBudget*.5?["Requested award exceeds 50% of annual budget; verify administrative capacity."]:[])];
 return{opportunity:grant,score:{grantId:grant.id,overallScore:Math.round(overallScore),components,eligibilityStatus:status,hardExclusions,warnings,scoredAt:new Date().toISOString()},chart:{applicationEffort:applicationEffort(grant,org),matchScore:Math.round(overallScore),awardAmount:max??min,daysRemaining:days}};
}
