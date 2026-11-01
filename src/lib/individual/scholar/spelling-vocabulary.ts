// ── SPELLING VOCABULARY ── owner instruction 1 Nov 2026 item 8 (intelligent spelling and terminology, P1) ──────────────
//
// The word lists spelling.ts reads. Modest by design: a word that is NOT here is left as typed (or, when it is close to a
// medicine or a medical word, offered as a "did you mean" question), never quietly rewritten. Three kinds:
//
//   GENERAL     everyday and instructional English. The ONLY words a token may be silently corrected TO.
//   MEDICAL     medical terminology. Known (never corrected), and never a silent correction target: a near miss is a question.
//   DRUGS       common medicine names (UK and US). Known; a near miss is a question; never a correction target.
//   CLINICAL_VALUE  words whose change alters clinical meaning (laterality, direction, frequency, route, negation, numbers in
//               words). A correction may never land on, or leave, one of these: it becomes a question.
//
// Plain data: no dependency, no I/O. Lower case, space separated, split once at load.

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

export const GENERAL_WORDS: readonly string[] = words(`
a about above according account across act action actions active activity actual actually add added adding addition additional address adequate adjust advance advantage advantages advice advise affect affected affects after again against age ages ago agree aim aims all allow allowed almost alone along already also alternative although always am among amount an analyse analysed analysis analyze and another answer answered answers any anyone anything anyway apart appear appearance applied apply applying approach approaches appropriate approximately are area areas argue argument around arrange as ask asked asking aspect aspects assess assessed assessing assessment assessments assignment assist associated assume at attempt available average avoid avoided aware away
back background bad balance base based basic basics basis be became because become becomes been before begin beginning behind being believe below benefit benefits best better between beyond big bit both bottom box brief briefly bring broad build built but by
calculate calculated calculating calculation calculations call called calls came can cannot care careful carefully carry case cases categories categorise categorize category cause caused causes causing certain chain chance change changed changes changing chapter characteristic characteristics characterise check checked checking checklist choice choices choose chosen circumstances clarify class classes classification classify clear clearly close closely code collect combination combine come comes coming common commonly communicate communication community compare compared comparing comparison complete completed complex component components concept concepts concern concerns conclude conclusion condition conditions conduct consider considered considering consistent contain contains content context continue contrast control correct correctly cost could count course cover covered create created criteria critical critically critique current currently cycle
daily data date day days deal decide decision decisions define defined definition definitions degree demonstrate depend depending depends describe described describing description design detail detailed details determine develop developed development diagram did differ difference differences different differentiate differentiating differentiation difficult difficulty direct directly discuss discussed discussion distinguish distinguishing do document documentation documented does doing done down draw due during duty
each early easy effect effective effects either elaborate element elements else emphasise emphasize end ensure enough environment equal error errors especially essay essential evaluate evaluated evaluating evaluation even event events ever every evidence exact exactly exam examination examine example examples exams except exercise expect expected experience explain explained explaining explains explanation explore expression extent extra
fact factor factors fail failed fall falls false far fast feature features feedback feel few field final finally find finding findings first fit five focus follow followed following for form forms formula forward found four framework free frequent frequently from full fully function functions further future
gain general generally get gets getting give given gives giving go goal goals goes going good got great group groups guidance guide guideline guidelines
had half happen happened happens hard has have having help helpful helping helps her here high higher highlight him his history hold home how however
idea ideas identified identify identifying if illustrate imagine impact importance important improve improvement in include included includes including increase increased indicate individual influence information initial input instead interpret interpretation into introduction involve involved involves is issue issues it item items its itself
just justify
keep key kind kinds know knowledge known
label large last later lead leads learn learned learning least lecture lectures less let level levels like likely limit limitation limitations limits line link linked links list listed little live long look looking lose loss lot low lower
made main mainly maintain major make makes making manage managed management managing many mark marks matter may maybe me mean meaning means measure measured measurement measures mechanism mechanisms meet member method methods might mind minor mnemonic model models module moment more most move much must my myself
name named names natural near necessary need needed needs negative never new next no none normal normally not note notes nothing now number numbers
objective objectives observe obtain occur occurs of off often okay on once one only open option options or order organise organize other others otherwise our out outcome outcomes outline outlined output over overall overview own
page paper part particular particularly parts past pattern patterns people per perform performed perhaps period person personal phase picture place plan planning play please point points policy positive possible potential practical practice practise prepare prepared preparing presence present presented presenting presents prevent prevented prevention previous primary principle principles prioritise prioritize priority probably problem problems procedure procedures process processes produce produced professional programme progress project provide provided provides purpose purposes put
quality question questions quick quickly quite quiz
range rate rather rationale reach read reading ready real really reason reasoning reasons recall receive received recent recognise recognised recognize recognized recommend recommended record recorded records reduce reduced reduces reduction refer reference referred reflect reflection reflective regarding related relation relationship relevant remain remember remembering remove report reported require required requirements requires research respond response responses responsibility rest result results return review revise revising revision right risk risks role roles rule rules run
safe safely safety same say scale scenario scenarios score second section see seen select sense separate sequence series serious set sets setting several short should show showing shows side sign significance significant signs similar similarities simple simply since single situation situations six size skill skills slow slowly small so some someone something sometimes soon sort source sources specific stage stages standard standards start started state statement states step steps still stop structure structured student students studies study studying style subject such suggest suitable summarise summarised summary summarize support sure system systems
table take taken takes taking talk task tasks teach teaching technique techniques tell term terms test tested tests text than that the their them theme then theoretical theory there therefore these they thing things think this those though three through throughout time times title to today together too tool tools topic topics total towards true try trying turn two type types typical typically
under understand understanding unit unless until up upon us use used useful uses using usual usually
valid value values various very via view
want wants was way ways we well went were what when where whether which while who whole why wide will with within without word words work worked working works would write writing written wrong
year years yes yet you your
able absence absent accept acceptable accepted access accident accurate achieve acquired activities acts admit admitted adult adults afraid afternoon agency ahead air alarm alert alive alright alter amongst analogy angle angry animal announce annual anxious anybody apparent appeal application appoint appointment arm arms army arrive arrived art article artificial aside asleep attach attack attend attention attitude author authority automatic autumn awake award awful
baby bag ball bank bar basket bath battle bay bear beat beautiful bed bedroom beer began begun behalf behave bell belong beside besides bill bind bird birth birthday black blame blank blind block blow blue board boat body bone book born borrow boss bother bottle bound boy branch brave bread break breakfast breast brick bridge bright brilliant broke broken brother brought brown brush budget bunch burden bus business busy buy
cake calm camera camp campaign candidate capable capacity capital captain car card careless carried cash cat catch caught ceiling central century chair chairman challenge champion channel charge charity cheap cheek cheese chemical chest chicken chief child childhood children chip chocolate church circle citizen city civil claim clean climb clinic clock cloth clothes cloud club coach coast coat coffee coin cold colleague collapse colour comfort comfortable command comment commit committee communities company competence competencies competency complain complaint completely complication complications compose computer concentrate concerned concert conflict confident confirm confused confusion connect connection conscious consequence contact continued continuous contract contrary conversation convince cook cool cope copy corner cottage council counter country couple courage court cousin crash crazy cream credit crew crime crisis crowd crown crush cry cultural culture cup cure curious curtain customer cut
damage dance danger dangerous dark daughter dead dear death debate debt decade declare deep defeat defence deficit delay deliberate delicate deliver demand deny department deposit depth deputy desk despite destroy determined device die died diet dig dinner dirty disappear discover dish dismiss display distance district divide doctor doctors dog dollar door double doubt dozen drama drawn dream dress drink drive driver drop dropped dropping drops dry dust
ear earlier earn earth ease east eat economic economy edge education effort egg eight elderly elect electric electricity elsewhere email emergency emotion emotional employ employee empty encourage enemy energy engine enjoy enormous enter entire entrance entry equipment escape establish estate estimate eventually everybody everyone everything everywhere evil excellent exchange excited exciting excuse executive exist existing expand expensive expert explode export expose extend extreme eye eyes
face facility fair faith familiar family famous fan farm farmer fashion fat father fault favourite fear fee feed feeling fellow female fence fight figure file fill film finance fine finger finish fire firm fish fixed flag flat flight floor flow flower fly fold folk food foot football force foreign forest forget forgive formal former fortune frame frank fresh friday friend friends friendly front fruit fuel fun fund funny furniture
game garden gas gate gather gave gender gentle gentleman genuine gift girl glad glass god gold golden government grade grand grant grass grateful green grew grey grief ground grow grown growth guard guess guest guilty gun guy
habit hair hall hand handle handover hang happy harm hat hate head heading hear heard heat heavily heavy height held hello hence hide highly hill hire hit hobby hole holiday hollow honest hope horse host hot hotel hour hours house household huge human hundred hungry hunt hurry hurt husband
ice ignore ill illness image immediate immediately impossible impression incident income independent index indoor industry infant inform informed injure inner innocent inside insist install instance institution instruction instructions insurance intend intention interest interested interesting internal international interview invite iron island
jacket job join joke journey judge juice jump junior jury justice
kick kid kill kind king kiss kitchen knee knife knock
lack lady lake land language lap largely late laugh law lawyer lay layer lazy leader leaf league lean leave leaving led leg legal lend length lesson letter library lie life lift light limb limited liquid listen lived lives living loan local lock lonely loop lord lot loud love lovely luck lucky lunch
machine mad magazine mail male man manner map market marriage married mass master match mate material mathematics meal meat media medical meeting memory men mention mess message metal middle midnight mile military milk million minister minute minutes mirror miss missed missing mistake mix mixed modern money monitor monitored monitoring month mood moon mother motor mountain mouse mouth movement movie mrs mum music
narrow nation national nature neck negotiate neighbour neither news newspaper nice nobody noise nor north nose notice novel nowhere nuclear
obvious obviously occasion odd offer office officer official oil ok old older onto operate operation opinion opportunity opposite orange ordinary organisation organization origin original outside owner
pack package paint pair palace pale panel panic parent parents park parliament partner party pass passage passed passenger path pay peace peak pen pencil pension percent perfect permanent permission permit persuade pet petrol phone photo physical piano pick piece pig pile pilot pin pink pipe pity plain plane planet plant plastic plate platform pleasant pleased plenty plus pocket poem poet police polite political politics pool poor pop popular population port pose position positioning possibility post pot pound pour poverty powder power powerful prayer precise prefer pregnant premises president press pretend pretty price pride priest prime prince print prison private prize proceed product profit promise proper properly property proportion proposal propose protect protection proud prove public pull punish pupil pure push
qualified queen query quiet
race radio rail rain ran rapid rapidly rare rarely raw reaction reactions reality recently recipe recover red refuse refused refusing region regular regularly regulate reject relax release relief religion religious rely remind rent repair repeat replace reply represent request rescue reserve resident residents resign resist resolve resource resources respect restaurant reveal rich ride ring rise river road rock roll roof room root rope rough round route royal rub rubbish rude ruin rural rush
sad sake salary sale salt sample sand satisfy save saved scan scene school science scientific scientist screen sea search season seat secret secretary security seek seem seize sell send senior sensible sent sentence seriously servant serve service session settle seven sex shake shall shape sharp sheet shelf shell shift shine ship shirt shoe shoot shop shopping shore shot shoulder shout shut shy sick sight signal silence silent silly silver sing singer sir sister sit site sitting sky sleep slight slightly slip smart smell smile smoke smoking smooth snow social society soft soil soldier solid solution solve son song sorry soul sound soup south space spare speak speaker speaking speech speed spend spent spirit split sport spot spread spring square staff stair stand star stare station stay steady steal steel stick stiff stone stood store storm story straight strange stranger street strength stress stretch strict strike string strong strongly struggle stuck stuff stupid succeed success successful sudden suddenly suffer sugar suggestion suit summer sun supply suppose surely surface surprise surprised surround survey survive suspect suspected sweet swim switch sympathy
tablet tablets tail talent tall tape target taste tax tea team tear technical technology teeth telephone television temporary tend tennis terrible terribly thank thanks theatre thick thin third thirsty thought threat throat throw thus ticket tie tight till tip tired tomorrow tone tongue tonight tooth top touch tough tour town toy track trade traffic transfer transport travel treat tree trend trial trick trip trouble trust truth tube tuesday
ugly unable uncle unfortunately uniform union unique universe university unknown unlike unlikely upper upset urban urge urgent urgently user
vacation valley van variety vast vehicle version victim video village visit visitor voice volume vote
wage wait wake walk wall war ward warm warn warning wash watch water wave weak wealth weapon wear weather wedding week weekend weigh weight welcome west wet wheel wherever white wife wild win wind window wine wing winner winter wire wise wish woman women wonder wonderful wood wooden wool worry worse worst worth wrap wrist
yard yellow yesterday young youth
`);

export const MEDICAL_WORDS: readonly string[] = words(`
abdomen abdominal abscess acidosis acute adrenal aetiology etiology airway airways alkalosis allergy allergic alveolar alveoli anaemia anemia anaesthesia anesthesia anaesthetic anesthetic analgesia analgesic anaphylaxis anaphylactic anatomy aneurysm angina angiotensin anorexia antibiotic antibiotics antibody antibodies anticoagulant anticoagulation antigen antiemetic aorta aortic apnoea apnea appendicitis arrhythmia arterial artery arteries arthritis ascites aseptic asthma asystole atrial atrium atrophy autoimmune autonomy
bacteria bacterial beneficence bilirubin biopsy bladder bleed bleeding blood bowel bradycardia brain breath breathe breathing breathlessness bronchi bronchial bronchiolitis bronchitis bronchodilator burn burns
cancer capillary carbohydrate carcinoma cardiac cardiology cardiovascular catheter catheterise catheterize cell cells cellulitis cerebral cholesterol chronic cirrhosis clinical clotting coagulation cognitive colitis colon coma confidentiality consent constipation contraindication contraindications copd coronary cortex cortisol cough cranial creatinine cyanosis cyst cystitis
defibrillation dehydration delirium dementia depression dermatitis diabetes diabetic diagnose diagnosis diagnoses diagnostic dialysis diarrhoea diarrhea diastolic differential digestion digestive disease diseases disorder disorders diuretic diuretics dizziness dose doses dosing drug drugs duodenal dysphagia dyspnoea dyspnea
eclampsia eczema electrolyte electrolytes embolism embolus emphysema encephalopathy endocrine endocrinology enzyme enzymes epidemiology epilepsy epithelial erysipelas erythema ethics ethical exacerbation
faeces feces fatigue femur fever fibrillation fibrosis fluid fluids foetal fetal foetus fetus fracture fractures
gallbladder gastric gastritis gastroenteritis gastrointestinal genetic gland glands glomerular glomerulonephritis glucose gout gynaecology gynecology
haematology hematology haematoma hematoma haemoglobin hemoglobin haemorrhage hemorrhage haemorrhagic hemorrhagic healing health heart hepatic hepatitis hernia hormone hormones hospital hydration hypercalcaemia hyperglycaemia hyperglycemia hyperkalaemia hyperkalemia hypertension hyperthyroidism hypocalcaemia hypoglycaemia hypoglycemia hypokalaemia hypokalemia hyponatraemia hyponatremia hypotension hypothermia hypothyroidism hypovolaemia hypovolemia hypoxia hypoxaemia
immune immunity immunisation immunization infarction infection infections infectious inflammation inflammatory influenza infusion inhaler inhalers injection injury injuries insulin intestine intestinal intramuscular intravenous ischaemia ischemia ischaemic ischemic
jaundice joint joints
ketoacidosis ketones kidney kidneys
labour labor lactate lesion leukaemia leukemia ligament liver lung lungs lupus lymph lymphatic lymphocyte lymphoma
malnutrition medication medications medicine medicines melanoma meningitis menopause mental metabolic metabolism metastasis microbiology mortality morbidity mucosa muscle muscles musculoskeletal myocardial myocardium
nausea nebuliser nebulizer nebulisers necrosis neonatal neonate nephritic nephron nephrons nephrotic nerve nerves nervous neurological neurology neuron neurone neurons neutropenia neutrophil nociception nutrition
obesity observations obstetric obstetrics obstruction occupational oedema edema oesophagus esophagus oesophageal esophageal oncology opioid opioids organ organs orthopaedic orthopedic osteoarthritis osteoporosis ovary overdose oximetry oxygen oxygenation
paediatric pediatric paediatrics pediatrics pain palliative palpitations pancreas pancreatitis paralysis pathogen pathology pathophysiology patient patients perfusion peptic peritonitis pharmacodynamics pharmacokinetics pharmacology physiology placenta plasma platelet platelets pleural pneumonia pneumothorax polydipsia polyuria postoperative pregnancy prescribe prescribed prescribing prescription pressure prognosis prostate protein proteinuria psoriasis psychiatric psychiatry psychology psychosis pulmonary pulse pyelonephritis
radiology rash reflex reflux rehabilitation renal resuscitation respiration respiratory resus retention rheumatoid rhythm
safeguarding saturation saturations schizophrenia sclerosis sedation seizure seizures sepsis septic serum shock sickle sinus skeletal skin spinal spine sputum stenosis steroid steroids stoma stomach stroke surgery surgical symptom symptoms syncope syndrome systemic systolic
tachycardia tachypnoea tachypnea temperature tendon therapy thorax thrombosis thrombus thyroid tissue tissues toxicity trachea transfusion trauma treatment treatments tremor triage troponin tuberculosis tumour tumor
ulcer ulcerative ulcers ultrasound urea ureter urethra urinary urinalysis urine uterus
vaccine vaccination vascular vein veins venous ventilation ventricle ventricular vertigo viral virus vital vomiting vomit
wheeze wheezing wound wounds
abcde acid aki alcohol alveolus amputation anticoagulants arrest arrhythmias assay audit beta blocker blockers bmi bnf bolus bowels bp calculi cardiomyopathy catheters cerebrovascular cholecystitis clot colonoscopy contraception crp cultures cyanosed dka delirious diuresis dyspepsia ecg electrocardiogram encephalitis endoscopy enteral erythrocyte exudate gcs glasgow haematuria hypoxic infarct inhibitor inhibitors intubation kg lethargy lumbar mmol nmc nsaids obs observation obstructive palpation parenteral percussion peritoneal phlebitis pleura pneumonitis polyp pruritus pyrexia pyrexial reflexes revalidation sats sbar seizing stenting sterile suicidal suicide suppository tachycardic bradycardic hypotensive hypertensive thiazide thrombolysis tia toxin tracheostomy tract vasodilation vasoconstriction ventilator wheezy aminoglycoside aminoglycosides renin aldosterone nephropathy neuropathy retinopathy cardiomegaly hyperthyroid hypothyroid glomerulus henle tubule tubular cortical medullary unfractionated fractionated molecular immunology microbial antimicrobial antiviral antifungal antipsychotic antidepressant anticonvulsant antihypertensive anxiolytic sedative hypnotic analgesics nebulised nebulized cannula cannulation venepuncture phlebotomy handwashing hygiene septicaemia bacteraemia mrsa capacity deprivation liberty dnacpr resuscitate choking collapsed collapses unresponsive unconscious fitting deteriorating deterioration overdosed polyuria
ankle ankles wrist elbow knee knees hip hips shoulder thigh calf shin heel toe toes finger thumb palm forearm groin pelvis pelvic neck jaw skull scalp lip lips gum gums eyelid pupil pupils meds med self
`);

export const DRUG_NAMES: readonly string[] = words(`
paracetamol acetaminophen ibuprofen naproxen diclofenac celecoxib aspirin codeine tramadol morphine oramorph oxycodone fentanyl diamorphine methadone buprenorphine naloxone
amoxicillin ampicillin flucloxacillin benzylpenicillin phenoxymethylpenicillin penicillin piperacillin tazobactam coamoxiclav clarithromycin erythromycin azithromycin doxycycline
metronidazole ciprofloxacin levofloxacin moxifloxacin trimethoprim nitrofurantoin gentamicin amikacin vancomycin teicoplanin ceftriaxone cefuroxime cefalexin cephalexin clindamycin
meropenem linezolid rifampicin isoniazid fluconazole nystatin aciclovir acyclovir oseltamivir
insulin metformin gliclazide sitagliptin empagliflozin dapagliflozin liraglutide semaglutide exenatide glucagon dextrose glucose
heparin enoxaparin dalteparin tinzaparin warfarin apixaban rivaroxaban edoxaban dabigatran clopidogrel ticagrelor alteplase tranexamic
furosemide frusemide bumetanide bendroflumethiazide indapamide spironolactone digoxin amiodarone adenosine atenolol bisoprolol metoprolol propranolol labetalol carvedilol
ramipril lisinopril enalapril perindopril losartan candesartan valsartan amlodipine nifedipine verapamil diltiazem hydralazine doxazosin isosorbide nitrate glyceryl trinitrate
atorvastatin simvastatin rosuvastatin pravastatin
omeprazole lansoprazole pantoprazole esomeprazole ranitidine famotidine ondansetron metoclopramide cyclizine prochlorperazine domperidone hyoscine buscopan lactulose senna macrogol loperamide
salbutamol albuterol terbutaline ipratropium tiotropium salmeterol formoterol beclometasone budesonide fluticasone montelukast aminophylline theophylline
prednisolone prednisone hydrocortisone dexamethasone methylprednisolone levothyroxine carbimazole
diazepam lorazepam midazolam clonazepam temazepam zopiclone haloperidol olanzapine quetiapine risperidone aripiprazole clozapine lithium
sertraline fluoxetine citalopram escitalopram paroxetine mirtazapine venlafaxine duloxetine amitriptyline gabapentin pregabalin
levetiracetam phenytoin valproate carbamazepine lamotrigine
adrenaline epinephrine noradrenaline norepinephrine dobutamine dopamine atropine
potassium magnesium calcium sodium bicarbonate chloride gluconate saline thiamine pabrinex folic ferrous vitamin
chlorphenamine cetirizine loratadine allopurinol colchicine methotrexate hydroxychloroquine sulfasalazine
adalimumab infliximab rituximab trastuzumab imatinib tamsulosin finasteride sumatriptan mannitol nimodipine nicotine
calpol nurofen
`);

/** Medicine-name endings. A token ending in one is treated as a medicine name: left as typed, never corrected. */
export const DRUG_SUFFIXES: readonly string[] = words(`
mycin micin cillin cycline pril olol alol sartan azole statin parin oxacin floxacin mab nib tide done pam lam zepam zolam
dipine triptan setron prazole tidine lukast sone olone gliptin gliflozin glutide xaban gatran vir mustine platin taxel
rubicin azepine oxetine afil terol barb caine profen
`);

/**
 * Words whose change alters clinical meaning. A correction never lands on one or leaves one: it is asked instead.
 * Numbers in words, laterality, direction, frequency, route and negation.
 */
export const CLINICAL_VALUE_WORDS: readonly string[] = words(`
left right high low higher lower hyper hypo increase decrease increased decreased raise raised reduce reduced more less above below before after
daily twice once thrice hourly weekly nightly morning evening night bedtime units unit dose doses milligram milligrams microgram micrograms gram grams
litre litres liter liters millilitre millilitres maximum minimum max min never always not no none nil stop start hold withhold omit
oral intravenous intramuscular subcutaneous topical rectal sublingual inhaled
zero one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty fifty hundred thousand half quarter double
`);

/**
 * British / American spelling pairs, [en-GB, en-US]. Both are always valid; with a variant chosen only these (and the
 * -ise / -ize stems below) are converted. Inflections are generated in spelling.ts.
 */
export const VARIANT_PAIRS: readonly (readonly [string, string])[] = [
  ["paediatric", "pediatric"], ["paediatrics", "pediatrics"], ["paediatrician", "pediatrician"], ["aetiology", "etiology"], ["aetiological", "etiological"],
  ["haemoglobin", "hemoglobin"], ["haemorrhage", "hemorrhage"], ["haemorrhagic", "hemorrhagic"], ["haematology", "hematology"], ["haematoma", "hematoma"],
  ["haematuria", "hematuria"], ["haemodynamic", "hemodynamic"], ["haemolysis", "hemolysis"], ["haemostasis", "hemostasis"],
  ["oedema", "edema"], ["oedematous", "edematous"], ["anaesthesia", "anesthesia"], ["anaesthetic", "anesthetic"], ["anaesthetist", "anesthetist"],
  ["anaemia", "anemia"], ["anaemic", "anemic"], ["ischaemia", "ischemia"], ["ischaemic", "ischemic"], ["leukaemia", "leukemia"],
  ["oesophagus", "esophagus"], ["oesophageal", "esophageal"], ["oestrogen", "estrogen"], ["faeces", "feces"], ["faecal", "fecal"],
  ["foetus", "fetus"], ["foetal", "fetal"], ["diarrhoea", "diarrhea"], ["dyspnoea", "dyspnea"], ["apnoea", "apnea"], ["tachypnoea", "tachypnea"],
  ["gynaecology", "gynecology"], ["orthopaedic", "orthopedic"], ["orthopaedics", "orthopedics"], ["hypoglycaemia", "hypoglycemia"],
  ["hyperglycaemia", "hyperglycemia"], ["hyperkalaemia", "hyperkalemia"], ["hypokalaemia", "hypokalemia"], ["hyponatraemia", "hyponatremia"],
  ["hypovolaemia", "hypovolemia"], ["hypoxaemia", "hypoxemia"], ["septicaemia", "septicemia"],
  ["tumour", "tumor"], ["tumours", "tumors"], ["colour", "color"], ["behaviour", "behavior"], ["behaviours", "behaviors"], ["labour", "labor"],
  ["favour", "favor"], ["centre", "center"], ["centres", "centers"], ["litre", "liter"], ["litres", "liters"], ["millilitre", "milliliter"],
  ["analyse", "analyze"], ["analysed", "analyzed"], ["analysing", "analyzing"], ["catalogue", "catalog"],
  ["nebuliser", "nebulizer"], ["nebulisers", "nebulizers"],
];

/** -ise / -ize stems (en-GB "organise" / en-US "organize"); inflections -ise -ised -ises -ising -isation -isations. */
export const IZE_STEMS: readonly string[] = words(`
organ recogn summar categor priorit minim maxim stabil hospital immun character emphas real util standard special visual memor critic apolog
final optim steril catheter mobil sensit normal general hypothes metabol random author familiar
`);

/**
 * Short informal forms read as the word they stand for (words under 4 letters are otherwise never changed). Only forms
 * that cannot be a unit, an abbreviation or a clinical value: never "u" (units), "r" (right) or "ur" (urine).
 */
export const SHORT_FORMS: Readonly<Record<string, string>> = {
  giv: "give", gve: "give", wat: "what", wot: "what", wht: "what", teh: "the", hw: "how", pls: "please", plz: "please", abt: "about",
  shud: "should", shld: "should", cud: "could", wud: "would", wen: "when", bcos: "because", becuz: "because", thx: "thanks",
};
