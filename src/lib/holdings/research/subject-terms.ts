import { SUBJECT_PHRASES } from "./subject-phrases";

/**
 * The closed vocabulary a research query may be built from, in the Holdings engine because it is research data for any
 * consumer. A word of a lesson leaves Competen only if it is here. A word that is not here never leaves, whatever it is,
 * so a name does not have to be recognised to be kept in: it only has to be absent.
 *
 * Nothing here is built from learner text. Lowercase ASCII, written by hand, reviewed as a list. British and American
 * spellings are both accepted by the reader (see subject-query.ts).
 */

/** Subject words beyond those of SUBJECT_PHRASES. No given names, surnames, places or institutions. */
const WORDS = `
abdomen abortion abrasion abscess absence acetaminophen acetylcholine achalasia acidosis acne acromegaly actinic acuity acupuncture adaptation addiction adenoma adenosine adenovirus adhesion adipose adolescence adolescents adrenaline adrenocortical aetiology aflatoxin ageing agitation agnosia agranulocytosis albumin albuminuria aldosterone alkalosis allele allergen alopecia alveolar alveoli amenorrhoea amino aminoglycoside amnesia amniocentesis amniotic amoebiasis amoxicillin amphetamine ampicillin amylase amyloid anabolic anaerobic analgesia androgen angiogram angiography angioplasty ankle anosmia anterior anthropometry antibody antibodies anticholinergic antigen antihelminthic antioxidant antiseptic antitoxin anuria anus aorta aphasia apoptosis appendix appetite arousal arteries artemisinin arteriosclerosis arthroplasty arthroscopy ascites asepsis aspirin astigmatism ataxia atelectasis atherosclerotic athetosis atresia atrophy attachment attribution audiometry auscultation autopsy axon azithromycin
babbling bacillus bacteraemia bacteria bariatric barotrauma bathing bedsore behaviourism benzodiazepine bicarbonate bile biliary bilirubin biofilm biomarker biomarkers biopsy biopsychosocial bioavailability biostatistics bisphosphonate blindness blister bloodstream bonding bradycardia brainstem breastmilk breastfed breech bronchial bronchoscopy bronchospasm bronchus bruise bruising bulla burns bursitis bypass
cachexia caffeine calculi calculus cancers candidiasis cannula capillary capnography carbapenem carbohydrate carbon carcinogen carcinoma cardiology cardiotocography cardioversion caregiver caregiving carotid cartilage catabolism catatonia catecholamine cation caudal cavity cefazolin ceftriaxone centile cephalocaudal cephalosporin cerebellum cerebrospinal cerebrovascular cerebrum cerumen cervix chemosis chemokine chickenpox chilblains chlorhexidine chloroquine cholangitis cholecystitis cholestasis cholesterol chorea chorioamnionitis chromosome chromosomes chronobiology ciprofloxacin circadian circumcision claudication clavicle cleft clostridium clotting clubfoot coagulopathy cocaine cochlea cochlear codeine cognition colectomy colic colitis collagen colon colonoscopy colostomy colostrum colposcopy comorbidity concussion conditioning conjunctival conjunctivitis consciousness contracture contusion convulsion convulsions cornea corneal coronavirus cortex corticotropin cortisol cough covid craniotomy creatinine crepitus cretinism crying cryotherapy cyanosis cyst cystitis cystoscopy cytokine cytokines cytology cytomegalovirus cytoplasm
deafness debridement decubitus defibrillation defibrillator dehydration delusion dentition depolarisation dermis desaturation detoxification dexamethasone dextrose diaphragm diastolic diathesis diazepam diclofenac diet digoxin dilation diplopia disinfectant dislocation diverticulitis diverticulosis dizziness dna dobutamine dopamine doppler dose dosage doxycycline drowsiness duodenal duodenum dysarthria dysentery dyslexia dyslipidaemia dysmenorrhoea dyspepsia dysplasia dyspnoea dystonia dysuria
ear echocardiography echocardiogram eczema edema electroconvulsive electroencephalography electromyography embolus embryo embryology emphysema empyema enalapril encephalitis endometriosis endometrium endoscopy endothelial endothelium endotoxin endotracheal enteric enterocolitis enterovirus enuresis enzymes eosinophil epidermis epidural epiglottitis epilepsies epinephrine episiotomy epistaxis epithelial epithelium erectile erythema erythrocyte erythromycin erythropoietin escherichia esophagitis estrogen exanthem exfoliative expectorant extubation eyelid
fallopian fascia fasciitis fatty femoral femur fentanyl fertility fetus fibrin fibrinogen fibroid fibroids fibula filtrate flexion flora flucloxacillin fluconazole fluoride flutter fontanel fontanelle formulae fractures frontal frostbite fundal fundus furosemide
galactosaemia gallbladder gamete gangrene gastrectomy gastric gastritis gastroparesis gastroscopy gastrostomy gene genes genetics genome genotype gentamicin giardiasis gingivitis gland glands glioma glomerulus glucagon glucocorticoid glutamate gluten glycogen glycosuria goitre gonadotropin granuloma granulocyte graft gut gynaecology
haematemesis haematoma haematuria haemoglobin haemoglobinopathy haemolysis haemolytic haemoptysis haemorrhoids haemothorax hallucination handwashing hantavirus helicobacter hemiparesis hemiplegia heparin hepatocellular hepatomegaly herpes heterozygous hippocampus histamine histology histopathology hives homocysteine homozygous hookworm hormones hospitalisation hydration hydrocortisone hydronephrosis hyperbilirubinaemia hypercalcaemia hypercapnia hypercholesterolaemia hyperglycaemia hyperlipidaemia hypermobility hypernatraemia hyperoxia hyperparathyroidism hyperpyrexia hypertonic hypertrophy hyperventilation hypnotic hypocalcaemia hypocapnia hypochondriasis hypokalaemia hypomania hypoparathyroidism hypospadias hypothalamus hypotonia hypoventilation hypoxaemia hypoxia hysterectomy hysteroscopy
ibuprofen ileostomy ileum ileus immunoglobulin immunotherapy impetigo implant incubation incubator indomethacin induction infancy infant infants infarct infectivity infiltration influenzae ingestion inhaler inotrope insomnia insulinoma intestine intoxication intrauterine intubation ischaemia isoniazid isotonic itch
jejunum joints jugular
keloid keratin keratitis ketamine ketone ketones kidneys kyphosis
labetalol labor laceration lactate lactose laparoscopy laparotomy laryngeal laryngitis laryngoscopy larynx leucocyte leukocyte leukopenia levothyroxine ligament limb linezolid lipase lipoprotein lithium lochia locomotor lorazepam lordosis lumbar lumen lungs lymph lymphadenopathy lymphocyte lymphoedema
macrophage macrosomia macular malignancy malignant mammography mania mannitol mantoux marasmus mastectomy mastitis maturation meconium mediastinum medulla megaloblastic meiosis melanoma melatonin meninges meningocele meniscus menarche menorrhagia menstruation mesothelioma metabolite metastasis metformin methadone methicillin methotrexate metronidazole microbiome microcephaly microscopy midazolam milestone mitochondria mitosis mitral mobilisation molar monoclonal monocyte mononucleosis morphine mosquito motor mucosa mucositis mucous mucus mumps murmur mycobacterium mycoplasma mycosis myelin myelitis myelomeningocele myocarditis myocardium myoclonus myometrium myopathy myopia myositis
naloxone nappy nasal nausea nebuliser necrosis necrotising neisseria neonate neonates nephritis nephrology nephron nephrotoxicity neuroanatomy neurobiology neurodevelopment neurodevelopmental neuroleptic neurology neuromuscular neuron neurons neuroplasticity neuropsychology neuroscience neurotransmitter neutropenia neutrophil nifedipine nitrate nitric nitrogen nitroglycerin nociception nocturia nodule norepinephrine norovirus nosocomial nystagmus
obstetrics oedematous oesophagitis oesophagus oestrogen olfactory oliguria omeprazole oncogene ondansetron oocyte oophorectomy ophthalmia optic orchitis organophosphates orthopaedics orthopnoea oseltamivir osmolality osmosis ossification osteogenesis osteomalacia osteopenia osteosarcoma ototoxicity ovarian ovulation oxycodone oxytocin
pacemaker paediatrics palate pallor palpation palpitations pancreas pandemic papilloedema paralysis paraplegia parasite parasites parasitic parasympathetic parathyroid parenting parenthood parkinsonism paroxysmal parturition pathogen pathogens pathogenesis pelvis penicillin pepsin percussion perfusion pericarditis pericardium perineal perineum peristalsis peritonitis peritoneum pessary petechiae pharmacology pharmacological pharmacotherapy pharyngitis pharynx phenobarbital phenotype phenylketonuria phenytoin phlebitis phlebotomy phobia phototherapy pica pinworm placentation plantar plaque plasma plasmodium plasticity platelet platelets pleurisy pneumococcal pneumocystis pneumonitis polio polycythaemia polydipsia polyhydramnios polymerase polyp polyuria posterior potassium prednisolone prednisone preeclampsia prematurity presbycusis presbyopia priapism primigravida primiparous progesterone prolactin pronation prone prostaglandin prostatitis proteinuria proximodistal pruritus pseudomonas psychiatric psychiatry psychoanalysis psychology psychometric psychomotor psychopathology psychotherapy psychotic pterygium ptosis puberty pubic pulmonology pupil purpura pyelonephritis pylori pyloric pyrexia
quadriplegia quinine
radial radiculopathy rash rectal rectum reflex reflexes refraction regurgitation remission renin reperfusion repolarisation resection respirator retina retinal retinoblastoma retinol retrovirus revascularisation rhabdomyolysis rhesus rheumatology rhinovirus riboflavin ribosome rifampicin ringworm rotavirus rubella
sacral salbutamol saline salmonella sarcoidosis sarcoma satiety scar schizoaffective sciatica scoliosis scrotum scurvy sebaceous secretion semen septum serology serotonin serum shigella shingles sibling sinus sinusitis skull smallpox smoking snake sodium somatic spasm spasticity spermatozoa sphincter sphygmomanometer spina spine spirometry spleen splenectomy splenomegaly spondylitis sputum staphylococcus stenosis stent sternum stethoscope stimulant stomach stomatitis stool streptococcus streptokinase streptomycin stridor subarachnoid subdural sucrose suicidal sulfonamide sulfonylurea supine surfactant suture swallowing sweat sympathetic synapse synaptic syncope synovial systole systolic
tachycardia tachypnoea taste temperament tendon tendonitis teratogen teratogenic teratology testes testicular testis testosterone thalamus thiamine thoracic thoracotomy thorax thrombocytopenia thrombus thrush thymus thyroidectomy thyroiditis thyrotoxicosis thyroxine tibia tinea tinnitus toddler toddlers tonsil tonsillectomy tooth torsion tourniquet toxic toxin toxoplasmosis trachea tracheal tranexamic tremor trimester trisomy troponin tubal tuberculin tumours tympanic typhus
ulceration ulcers ulna ultraviolet underweight undernutrition urea ureter urethra urethritis uric urinalysis urine urology urticaria uterine uterus uveitis
vaccinations vaginal vaginitis vaginosis vagus valve vancomycin varicella vasculitis vasoconstriction vasodilation vasodilator ventilator ventricle ventricular verruca vertigo vesicle vestibular vibrio virology virulence viruses vision vitiligo vomiting vulva
warfarin weaning wheeze wheezing withdrawal wounds
xerostomia
zygote zidovudine zinc
incident incidents maleficence modification transmission reaction reactions
acyclovir adalimumab albendazole allopurinol amiodarone amitriptyline amlodipine antivenom atenolol atropine azathioprine baclofen bevacizumab biologic biologics bisoprolol budesonide bupivacaine captopril carbamazepine carbimazole carbidopa cetirizine chlorpromazine cholinesterase cisplatin citalopram clindamycin clonazepam clopidogrel clozapine colchicine copper cotrimoxazole cyclophosphamide dapagliflozin dapsone desmopressin digitalis diltiazem donepezil enoxaparin ergometrine escitalopram ethambutol fluoxetine gabapentin glibenclamide haloperidol hydralazine hydroxyurea hydroxychloroquine infliximab insulin ipratropium isosorbide ivermectin ketorolac lamotrigine levetiracetam levodopa lidocaine lignocaine loperamide losartan mebendazole mesalazine methyldopa metoclopramide metoprolol misoprostol nevirapine nitrofurantoin noradrenaline olanzapine oxytetracycline pantoprazole paroxetine praziquantel prochlorperazine propofol propranolol pyrazinamide quetiapine ranitidine remdesivir rifabutin risperidone rituximab sertraline sildenafil simvastatin spironolactone sulfadoxine tamoxifen tenofovir terbutaline tetracycline tramadol trastuzumab valproate vasopressin venlafaxine verapamil
anthropometric antenatally apnea arrhythmias ascariasis aspergillosis beriberi bradyarrhythmia bronchopneumonia cannabis chancroid chlamydial chromoblastomycosis colposuspension cryptococcosis cryptosporidiosis cysticercosis dengue donovanosis dracunculiasis echinococcosis encephalocele fascioliasis geohelminth hydatid histoplasmosis hyperemesis kernicterus kuru kwashiorkor lathyrism leishmania loiasis lymphogranuloma melioidosis mycetoma pellagra rickets sporotrichosis strongyloidiasis taeniasis trichomoniasis trichuriasis tularaemia tungiasis yaws
ascaris aspergillus bordetella borrelia brucella cryptococcus cryptosporidium entamoeba giardia klebsiella legionella leptospira listeria onchocerca schistosoma strongyloides taenia treponema trypanosoma wuchereria
adherent ambulatory aphthous benchmark biometric calcification cardiorespiratory cerebellar chorionic compliance craniofacial cutaneous dermal diagnostic dorsal embolic endogenous epileptic exogenous extremity fetoplacental fontanelles gestation height hemispheric hepatobiliary histological hydrocele immunocompromised incisional infratentorial intraosseous intrathecal intrauterine ligation macrosomic maxillofacial mediastinal mesenteric microvascular mucocutaneous myelosuppression nasopharyngeal neurocognitive neuroendocrine nocturnal oropharyngeal orthostatic palatal paresthesia peroral perinatology pneumoperitoneum polyneuropathy postural pulmonic pyogenic rating numeric retroperitoneal subclavian subcutaneous submucosal supraventricular tachyarrhythmia thromboprophylaxis transfusion transdermal transvaginal urogenital vasoactive vasovagal venography
`;

/** Scholarly and educational subject words: what teaching and research are about, not one document. */
const STUDY_WORDS = `
abilities accommodation achievement acquisition affective ageism aggression algorithm altruism ambulation analytical andragogy anthropology articulation assimilation attitudes authoritative
behaviours bilingual bilingualism bivariate blinding bullying
capability causation chronotype coding coherence cohesion colonisation comorbidities competencies comprehension conception confounders conservation constructivism constructivist correlation creativity crisis
deductive deprivation diagram diagrams didactic discrimination diversity
ecological egocentrism emotion emotions empirical epigenetic epigenetics equilibrium ergonomic ergonomics ethnicity ethnography
falsification fidelity fundamental
gamification gerontology
heritability heuristic hierarchy humanistic
imitation immersion immigrant inductive inequality instruction intergenerational intervention interventions intuition
kappa kinesiology
lifespan logistics longitudinal
malpractice meaning mentorship metaphor mindfulness modelling morality multivariate multilingualism
neurodiversity nomogram norms nurture
obesogenic ontogeny
paradigm pedagogy perception period periods phonological phonology pedagogical phenomenology poverty praxis prejudice preschool prognosis
randomisation reinforcement reproducibility rubric
schema schemas semantic semantics sensitive sociocultural socioeconomic sociology spirituality stage stages stereotype stereotyping stimulation subgroup syntax
theories transgender triangulation trust
variance vocabulary vulnerability
worksheet
`;

/** Abbreviations that are the subject, read as written. Letters only. */
const ABBREVIATIONS = `
aids ards bmi cbt ckd copd cpr dka dvt ecg ecmo eeg fmea gcs gerd gord hiv hpv ibd ibs icu ipc iud iugr mers mri mrsa nicu nsaid nsaids osce pdca pdsa picu pcr ppe pph ptsd sars sbar sga sle sofa qsofa uti vte
`;

/**
 * Words of a person's or place's name that are the established term in their own right, and are rarely anyone's name in a
 * lesson. Other established names are common surnames: those are in ESTABLISHED_TERMS, and pass only as the whole term.
 */
const ESTABLISHED_NAMES = `
ainsworth alzheimer andragogy apgar asperger babinski ballard bandura barthel bonferroni bowlby braden bronfenbrenner brudzinski burkitt chikungunya chvostek cronbach crohn donabedian dubowitz duchenne ebola erikson freud gesell golgi harlow hashimoto heimlich hirschsprung huntington ishikawa kawasaki kernig klinefelter kohlberg konzo korotkoff korsakoff krebs kruskal kussmaul lassa leininger likert marburg marfan maslow montessori moro naegele noma pareto parkinson patau pavlov peplau piaget raynaud rett rinne romberg rovsing snellen takayasu tanner tourette trendelenburg vygotsky waterlow wechsler wernicke wilcoxon zika
`;

/** Established terms carrying a word that is also a common name or an everyday word. They pass only whole. */
export const ESTABLISHED_TERMS: readonly string[] = [
  // tropical and neglected diseases
  "buruli ulcer", "chagas disease", "crimean congo", "hansen disease", "japanese encephalitis", "kala azar", "nodding syndrome", "q fever", "rift valley fever", "river blindness", "scrub typhus", "sleeping sickness", "typhoid fever", "west nile", "yellow fever",
  // diseases and syndromes
  "alport syndrome", "apert syndrome", "bartter syndrome", "barrett oesophagus", "beckwith wiedemann", "behcet disease", "berger disease", "bernard soulier", "boerhaave syndrome", "brown sequard", "budd chiari", "castleman disease", "charcot foot", "charcot marie tooth",
  "creutzfeldt jakob", "crigler najjar", "crouzon syndrome", "de quervain", "diamond blackfan", "digeorge syndrome", "dubin johnson", "dupuytren contracture", "fabry disease", "fanconi anaemia", "felty syndrome", "fournier gangrene", "gardner syndrome", "gaucher disease",
  "gilbert syndrome", "gitelman syndrome", "glanzmann thrombasthenia", "goodpasture syndrome", "horner syndrome", "hunter syndrome", "hurler syndrome", "kallmann syndrome", "lambert eaton", "legg calve perthes", "lesch nyhan", "lewy body", "liddle syndrome", "ludwig angina", "lynch syndrome",
  "meniere disease", "mondor disease", "munchausen syndrome", "nelson syndrome", "niemann pick", "osgood schlatter", "pancoast tumour", "perthes disease", "peutz jeghers", "peyronie disease", "pick disease", "pierre robin", "plummer vinson", "pompe disease", "reiter syndrome",
  "sanfilippo syndrome", "simmonds disease", "sjogren syndrome", "stickler syndrome", "still disease", "sturge weber", "tietze syndrome", "treacher collins", "vincent angina", "von hippel lindau", "von willebrand", "waldenstrom", "waterhouse friderichsen", "wernicke korsakoff", "whipple disease", "zenker diverticulum",
  // scores, scales, tests and signs
  "aldrete score", "barlow manoeuvre", "beck triad", "braxton hicks", "charcot triad", "cushing triad", "curb score", "edinburgh postnatal depression", "epley manoeuvre", "finnegan score", "flacc scale", "foley catheter", "framingham risk", "goodell sign", "hegar sign", "hickman line", "hardy weinberg", "kehr sign",
  "koch postulates", "lachman test", "leopold manoeuvres", "mcgill pain", "mcmurray test", "mallampati score", "meld score", "morse fall scale", "norton scale", "ortolani manoeuvre", "pfannenstiel incision", "phalen test", "ponseti method", "rankin scale", "robson classification", "romberg test", "seldinger technique", "swan ganz", "thomas test", "tinel sign", "valsalva manoeuvre", "wong baker",
  // theories and models
  "effect modification", "epidemiological triangle", "health belief model", "kolb experiential", "non maleficence", "number needed to treat", "number needed to harm", "wolff parkinson white",
  "benner novice", "casey model", "driscoll model", "gibbs reflective", "hersey blanchard", "herzberg theory", "honey mumford", "johns model", "knowles andragogy", "kubler ross", "mcgregor theory", "mezirow transformative", "mintzberg", "nolan model", "roper logan tierney", "rolfe reflective", "schon reflective", "tannahill model", "belbin team",
  "addison disease", "angelman syndrome", "bayley scales", "beck depression inventory", "bed bath", "bell palsy", "bishop score", "bloom taxonomy", "broca area", "cheyne stokes", "child pugh",
  "colles fracture", "conn syndrome", "cullen sign", "cushing syndrome", "cushing disease", "denver developmental", "down syndrome", "dreyfus model", "driver diagram", "dunning kruger", "edwards syndrome",
  "ehlers danlos", "ewing sarcoma", "fisher exact", "fowler position", "fragile x", "frank starling", "friedreich ataxia", "gantt chart", "glasgow coma scale", "gram stain", "graves disease",
  "grey turner", "guillain barre", "hamilton depression", "hawthorne effect", "henderson need theory", "henoch schonlein", "hodgkin lymphoma", "homan sign", "kaplan meier", "kaposi sarcoma",
  "king goal attainment", "kirkpatrick model", "kolb learning cycle", "kotter change model", "lewin change model", "lyme disease", "mallory weiss", "mann whitney", "mcburney point", "mcroberts manoeuvre",
  "meckel diverticulum", "miller pyramid", "murphy sign", "neuman systems model", "nightingale environmental theory", "noonan syndrome", "orem self care", "paget disease", "pearson correlation",
  "pender health promotion", "pott disease", "prader willi", "ramsay sedation", "reye syndrome", "richmond agitation", "rogers diffusion", "roy adaptation model", "salter harris", "sheehan syndrome",
  "silverman andersen", "skinner operant", "spearman correlation", "stanford binet", "stevens johnson", "swiss cheese model", "tay sachs", "trousseau sign", "tuckman stages", "turner syndrome",
  "virchow triad", "watson caring", "weber test", "wells score", "williams syndrome", "wilms tumour", "wilson disease", "ziehl neelsen", "zollinger ellison",
];

/**
 * Words of SUBJECT_PHRASES that are a common surname, a place, or part of how a document or a workplace describes itself.
 * Inside their whole phrase they are fine ("bell palsy", "hospital acquired"). Otherwise they do not leave.
 */
const PHRASE_ONLY = `
a b bank c cross e p barre bell bloom cushing department district faculty glasgow guillain hodgkin hospital hospitals item items job kangaroo law long magnet mass men military minors number office officer one pilot power project road root rural school second section six site staff stick stones student two water white women workers yellow
`;

/**
 * Everyday words that say nothing by themselves but belong to a subject when next to one: "personal hygiene", "critical
 * period". They leave only touching a subject word, never alone, and a word that is not here or in the vocabulary never does.
 */
const EVERYDAY = `
managing supporting administering preventing assessing recognising providing reducing improving promoting moving caring handling young older old new adults calculations conversations relationships staging
syndrome syndromes disorder disorders disease diseases condition directly observed
act action active advance comfort advanced agents aid alert alignment angle anti attack back background bad base based basic bath bed body breaking case cast cause central chain change channel choice classes closed cold collection concern conditions conduct content contact control cord cost crew critical cycle de debate deep delay design difficult directed double driver dynamics early effect end episode error errors event events exchange external failure falls family first flags focus foot function general generation gravis grade group groups half hand head hidden high hip history home information internal interest interval just ladder lean led levels life likelihood load local loop loss low machine major making male mapping media misses mixed mobile mode mother motherhood near needed needle never news non normal objective observation open organ partner pass pattern person personal plan planning plastic platforms play point policy population post practice pre precision problem process public question questions raised random rapid rate ratio ratios recall red reference report reported reporting response results review rights risk routes safe sample security self semi series service services setting severe shared shift shifting side sigma signs situation size special standard state states status study supply support surface system systems taking task team teams term test testing tests theatre thinking time tools tracing traffic transfer transport travel treat treated trial truth type upper use value victim wearable work working wrong zone
`;

const list = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export const EVERYDAY_WORDS: readonly string[] = list(EVERYDAY);
const notAlone = new Set([...list(PHRASE_ONLY), ...EVERYDAY_WORDS]);
const fromPhrases = [...new Set(SUBJECT_PHRASES.flatMap(p => p.split(/[\s-]+/)))].filter(w => !notAlone.has(w) && !notAlone.has(w.replace(/ies$/, "y")) && !notAlone.has(w.replace(/s$/, "")));

/** Every word a query may carry on its own. */
export const SUBJECT_WORDS: readonly string[] = [...new Set([...fromPhrases, ...list(WORDS), ...list(STUDY_WORDS), ...list(ABBREVIATIONS), ...list(ESTABLISHED_NAMES)])];

/**
 * Word endings that belong to medical vocabulary, for a disease, procedure or medicine this list does not hold. Whole-name
 * collisions are tested against a list of real names (subject-query.test.ts). Applied only to long words.
 */
export const MEDICAL_ENDINGS = /(?:itis|osis|iasis|aemia|emia|ectomy|otomy|ostomy|plasty|scopy|pathy|ology|ography|algia|plegia|paresis|trophy|genesis|lysis|cillin|mycin|floxacin|azole|sartan|statin|prazole|dipine|virus|coccus|bacter)$/;
export const MEDICAL_ENDING_MIN = 8;
