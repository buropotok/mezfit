// Deterministic Russian display-name normalization for the canonical upstream catalogue.
// Keep upstream English in name_en; this function is only for bundled Russian UI labels.
const phrases = new Map(Object.entries({
  'romanian deadlift':'румынская становая тяга','stiff leg deadlift':'становая тяга на прямых ногах','straight leg deadlift':'становая тяга на прямых ногах',
  'bench press':'жим лёжа','shoulder press':'жим на плечи','overhead press':'жим над головой','chest press':'жим от груди','leg press':'жим ногами','military press':'армейский жим','svend press':'жим Свенда',
  'push up':'отжимания','push-up':'отжимания','pull up':'подтягивания','pull-up':'подтягивания','chin up':'подтягивания обратным хватом','chin-up':'подтягивания обратным хватом','sit up':'подъём корпуса','sit-up':'подъём корпуса',
  'deadlift':'становая тяга','split squat':'сплит-присед','squat':'приседания','lunge':'выпады','step up':'зашагивания','step-up':'зашагивания','hip thrust':'ягодичный мост','glute bridge':'ягодичный мост',
  'calf raise':'подъём на носки','leg raise':'подъём ног','leg extension':'разгибание ног','leg curl':'сгибание ног','biceps curl':'сгибание на бицепс','bicep curl':'сгибание на бицепс','wrist curl':'сгибание запястий','triceps extension':'разгибание на трицепс','tricep extension':'разгибание на трицепс',
  'lat pulldown':'тяга верхнего блока','pulldown':'тяга верхнего блока','pushdown':'разгибание на блоке','upright row':'тяга к подбородку','row':'тяга','fly':'разведение','lateral raise':'подъём рук в стороны','front raise':'подъём рук перед собой','rear delt':'задняя дельта',
  'shrug':'шраги','pullover':'пуловер','crunch':'скручивания','plank':'планка','twist':'скручивания','rotation':'вращение','stretch':'растяжка','dip':'отжимания на брусьях','dips':'отжимания на брусьях','kickback':'отведение назад','good morning':'наклоны «Доброе утро»','clean':'взятие на грудь','snatch':'рывок',
  'one arm':'одной рукой','one leg':'на одной ноге','single arm':'одной рукой','single leg':'на одной ноге','close grip':'узким хватом','wide grip':'широким хватом','neutral grip':'нейтральным хватом','reverse grip':'обратным хватом','behind the head':'за головой','behind head':'за головой',
  'medicine ball':'медбол','stability ball':'фитбол','exercise ball':'фитбол','body weight':'с весом тела','bodyweight':'с весом тела'
}));
const words = new Map(Object.entries({
  dumbbell:'гантели',dumbbells:'гантели',barbell:'штанга',cable:'блок',band:'эспандер',kettlebell:'гиря',smith:'Смит',lever:'тренажёр',machine:'тренажёр',sled:'сани',weighted:'с отягощением',assisted:'с поддержкой',
  curl:'сгибание',curls:'сгибания',press:'жим',raise:'подъём',raises:'подъёмы',extension:'разгибание',row:'тяга',pull:'тяга',push:'жим',squat:'приседания',bridge:'мост',jump:'прыжок',run:'бег',walking:'ходьба',walk:'ходьба',throw:'бросок',lift:'подъём',swing:'мах',carry:'переноска',
  seated:'сидя',standing:'стоя',lying:'лёжа',kneeling:'на коленях',hanging:'в висе',prone:'лёжа на животе',supine:'лёжа на спине',incline:'наклонный',decline:'с отрицательным наклоном',reverse:'обратный',alternate:'попеременно',alternating:'попеременно',overhead:'над головой',front:'передний',rear:'задний',lateral:'боковой',straight:'прямой',bent:'согнутый',high:'верхний',low:'нижний',inner:'внутренний',outer:'наружный',full:'полный',vertical:'вертикальный',horizontal:'горизонтальный',close:'узкий',wide:'широкий',narrow:'узкий',
  arm:'рука',arms:'руки',leg:'нога',legs:'ноги',chest:'грудь',back:'спина',shoulder:'плечо',shoulders:'плечи',calf:'икры',calves:'икры',hip:'таз',glute:'ягодицы',glutes:'ягодицы',hamstring:'бицепс бедра',biceps:'бицепс',bicep:'бицепс',triceps:'трицепс',tricep:'трицепс',wrist:'запястье',knee:'колено',knees:'колени',neck:'шея',delt:'дельта',lat:'широчайшие',abs:'пресс',abdominal:'пресс',oblique:'косые мышцы',
  grip:'хват',rope:'канат',bar:'гриф',bench:'скамья',floor:'на полу',wall:'у стены',ball:'мяч',roller:'ролик',wheel:'ролик',resistance:'с сопротивлением',body:'тело',hands:'руки',hand:'рука',head:'голова',toe:'носок',elbow:'локоть',towel:'полотенце',palm:'ладонь',palms:'ладони',finger:'палец',ankle:'голеностоп',heel:'пятка',
  hammer:'молотковые',concentration:'концентрированные',preacher:'на скамье Скотта',spider:'паучьи',russian:'русский',french:'французский',arnold:'Арнольда',sumo:'сумо',hack:'гакк',pallof:'Паллофа',zottman:'Зоттмана',zercher:'Зерхера',jefferson:'Джефферсона',turkish:'турецкий',
  abduction:'отведение',adduction:'приведение',flexion:'сгибание',pronation:'пронация',supination:'супинация',isometric:'изометрический',dynamic:'динамический',rotation:'вращение',twisting:'со скручиванием',inverted:'обратный',suspended:'в подвесе',supported:'с опорой',
  on:'на',with:'с',to:'к',and:'и',of:'',the:'',in:'в',from:'из',over:'над',under:'под',against:'у',through:'через',between:'между',around:'вокруг',off:'',both:'обеими',
  male:'',female:'',exercise:'',pov:'',ez:'EZ',bosu:'BOSU',v:'V',t:'T',l:'L',jm:'JM'
}));
const translit={a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'дж',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'кс',y:'й',z:'з'};
function transliterate(word){return [...word.toLowerCase()].map(c=>translit[c]??c).join('')}
export function russianExerciseName(english){
  let value=String(english||'').trim().toLowerCase().replace(/[()]/g,' ').replace(/[-–]+/g,' ');
  for(const [from,to] of [...phrases].sort((a,b)=>b[0].length-a[0].length)) value=value.replace(new RegExp(`(^|\\s)${from.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(?=\\s|$)`,'g'),`$1${to}`);
  value=value.replace(/[a-z]+/g,m=>words.get(m)??transliterate(m));
  value=value.replace(/\s+/g,' ').replace(/\s+([,.;:])/g,'$1').trim();
  if(!/[а-яё]/i.test(value)) throw new Error(`Russian exercise name has no Cyrillic content: ${english}`);
  return value.charAt(0).toUpperCase()+value.slice(1);
}
