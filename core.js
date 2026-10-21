/* core.js — محرك المحاسبة والمخزن. يُحمَّل بعد سكربت الصفحة: <script src="core.js"></script> */
(()=>{
const nid=()=>db.seq++,now=()=>Date.now(),R=n=>Math.round((+n||0)*100)/100,fail=m=>{throw new Error(m)};
const log=(a,d)=>db.log.push({id:nid(),ts:now(),day:today(),a,d});
const isAdmin=pw=>pw===db.p;
const inv=id=>db.inv.find(x=>x.id==id)||fail('الفاتورة غير موجودة');
const owed=i=>Math.max(0,R(i.tot-i.paid-(i.red||0)));
const led=(c,i,d,cr,desc)=>db.led.push({id:nid(),ts:now(),day:today(),c,inv:i,d,cr,desc});
const pay=(i,amt,m,k,ts,day)=>db.pay.push({id:nid(),ts:ts||now(),day:day||today(),c:i.c,inv:i.id,amt,m,k});
const dl=(i,x,q,s=1,ts=now(),day=today())=>db.dlv.push({id:nid(),ts,day,inv:i.id,pid:x.pid,n:x.n,q:s*q,qb:s*q*x.f,rev:R(s*q*x.np),cost:R(s*q*x.cp)});

/* معاملة آمنة: كل شيء ينجح أو يُسترجع كما كان */
function tx(fn){const snap=JSON.stringify(db);try{const r=fn();save();return r}catch(e){const o=JSON.parse(snap);Object.keys(db).forEach(k=>delete db[k]);Object.assign(db,o);throw e}}
const T=f=>(...a)=>tx(()=>f(...a));

/* ترحيل البيانات القديمة (مرة واحدة) */
function migrate(){if(db.v4)return;
['log','dlv','led','stk','sin','spay'].forEach(k=>db[k]=db[k]||[]);
db.prods.forEach(p=>{if(p.cost===undefined)p.cost=null;if(p.ro==null)p.ro=db.shop.low});
db.cust.forEach(c=>c.cr=c.cr||0);
db.pay.forEach(p=>{p.m=p.m||'cash';p.k=p.k||'collect';p.inv=p.inv||0});
db.inv.forEach(i=>{const f=i.s?(i.s-i.d)/i.s:1,rs=i.items.some(x=>x.rsv);i.red=0;i.m='cash';i.feeShop=false;
 i.items.forEach(x=>{x.np=R(x.pr*f);x.cp=R((prod(x.pid)&&prod(x.pid).cost||0)*x.f);if(!x.rsv)dl(i,x,x.q,1,i.ts,i.day)});
 if(i.paid)pay(i,i.paid,'cash',rs?'deposit':'sale',i.ts,i.day)});
db.ret.forEach(r=>{const i=db.inv.find(x=>x.id==r.inv),x=i&&i.items.find(y=>y.n==r.n);if(!x)return;dl(i,x,r.q,-1,r.ts,r.day);
 if(i.t=='credit')i.red=Math.min(R(i.red+r.amt),i.tot-i.paid);else pay(i,-r.amt,'cash','refund',r.ts,r.day)});
db.pay.filter(p=>!p.inv&&p.k=='collect').forEach(p=>{let r=p.amt;for(const i of db.inv.filter(i=>i.c==p.c&&owed(i)>0)){const a=Math.min(r,owed(i));i.paid=R(i.paid+a);r=R(r-a);if(r<=0)break}});
db.rsv.forEach(r=>{r.st=r.q>r.drawn?'open':'done';const i=db.inv.find(x=>x.id==r.inv);if(i&&r.drawn>0)dl(i,i.items[0],r.drawn)});
db.cust.forEach(c=>{if(c.bal>0)led(c.id,0,c.bal,0,'رصيد افتتاحي (قبل الترقية)')});
db.v4=1;save()}

/* البيع مع التحقق الصارم */
function _sell(cart,cf){
 if(!cart.length)fail('الفاتورة فارغة');
 if(cart.some(x=>!(x.q>0)||!(x.pr>=0)))fail('كميات أو أسعار غير صحيحة (لا سالب)');
 const fee=+cf.fee||0,dv=+cf.dv||0,s=R(sum(cart,x=>x.q*x.pr));
 if(fee<0||dv<0)fail('لا يُقبل نقل أو خصم بالسالب');
 const d=R(cf.dt=='p'?s*dv/100:dv);if(d>s)fail('الخصم أكبر من مجموع المواد');
 const v=R((s-d)*(db.shop.vat||0)/100),shop=!!cf.feeShop,tot=R(s-d+v+(shop?0:fee));
 const paid=cf.t=='cash'?tot:R(+cf.pd||0);if(paid<0||paid>tot)fail('المدفوع أكبر من إجمالي الفاتورة');
 if(cf.t=='credit'&&!cf.c)fail('اختر العميل للفاتورة الآجلة');
 const f=s?(s-d)/s:1,i={id:nid(),ts:now(),day:today(),c:cf.c,t:cf.t,m:cf.m||'cash',s,d,v,fee,feeShop:shop,tot,paid,red:0,site:cf.site,
  items:cart.map(x=>{const p=prod(x.pid);if(!p||p.off)fail('منتج غير موجود أو موقوف: '+x.n);if(p.cost==null)fail('حدّد سعر التكلفة للمنتج: '+p.n);
   p.qty-=x.q*x.f;return{...x,r:0,np:R(x.pr*f),cp:R(p.cost*x.f)}})};
 db.inv.push(i);i.items.forEach(x=>dl(i,x,x.q));
 if(shop&&fee)db.dlv.push({id:nid(),ts:i.ts,day:i.day,inv:i.id,pid:0,n:'نقل وعتالة',q:0,qb:0,rev:0,cost:fee});
 if(paid)pay(i,paid,i.m,'sale');
 if(cf.t=='credit'){const c=cust(cf.c);c.bal=R(c.bal+tot-paid);led(c.id,i.id,tot,0,'فاتورة #'+i.id);if(paid)led(c.id,i.id,0,paid,'دفعة عند الشراء')}
 log('sale',{inv:i.id,tot});return i}

/* رد قيمة: يخصم من الدين المتبقي للفاتورة أولاً، والفائض رصيد دائن (لا يصبح الرصيد سالباً) */
function back(i,a,why){const o=owed(i),dp=Math.min(a,o),sp=R(a-dp),c=i.c&&cust(i.c);
 if(dp>0&&c){i.red=R(i.red+dp);c.bal=R(c.bal-dp);led(c.id,i.id,0,dp,why)}
 if(sp>0){if(c&&(i.t=='credit'||i.items.some(x=>x.rsv))){c.cr=R(c.cr+sp);led(c.id,i.id,0,0,'رصيد دائن +'+sp+' ('+why+')')}else pay(i,-sp,i.m,'refund')}}

function _ret(id,j,q){const i=inv(id),x=i.items[j];if(i.void)fail('الفاتورة ملغاة');if(x.rsv)fail('بند حجز: يُلغى الحجز بدلاً من الإرجاع');
 if(!(q>0)||q>x.q-x.r)fail('كمية غير صحيحة');const a=R(q*x.np);   // سعر الشراء الفعلي بعد الخصم
 x.r+=q;prod(x.pid).qty+=q*x.f;db.ret.push({id:nid(),ts:now(),day:today(),inv:id,n:x.n,q,amt:a,t:i.t});dl(i,x,q,-1);back(i,a,'مرتجع فاتورة #'+id);log('return',{inv:id,n:x.n,q,a})}

/* تحصيل مرتبط بفاتورة (أو توزيع تلقائي على الأقدم) */
function _collect(cid,amt,m,invId){amt=R(amt);if(!(amt>0))fail('أدخل مبلغاً صحيحاً');const c=cust(cid);
 const L=db.inv.filter(i=>i.c==cid&&!i.void&&owed(i)>0&&(!invId||i.id==invId)),tot=R(sum(L,owed));
 if(amt>tot)fail('المبلغ أكبر من المتبقي على العميل ('+tot+')');
 let r=amt;for(const i of L){const a=Math.min(r,owed(i));if(a<=0)break;i.paid=R(i.paid+a);pay(i,a,m||'cash','collect');led(cid,i.id,0,a,'سداد على فاتورة #'+i.id);r=R(r-a)}
 c.bal=R(c.bal-amt);if(c.bal<=0)delete c.due;log('collect',{cid,amt});return amt}

/* إلغاء فاتورة (مدير فقط) */
function _cancel(id,pw,why){if(!isAdmin(pw))fail('الإلغاء والتعديل للمدير فقط');const i=inv(id);if(i.void)fail('الفاتورة ملغاة مسبقاً');const r=db.rsv.find(x=>x.inv==id);
 i.items.forEach(x=>{const p=prod(x.pid);if(!p)return;if(x.rsv){if(r&&r.st=='open')p.res=Math.max(0,R(p.res-(r.q-r.drawn)));p.qty+=r?r.drawn:0}else p.qty+=(x.q-x.r)*x.f});
 if(r)r.st='void';
 db.dlv.filter(d=>d.inv==id).forEach(d=>db.dlv.push({...d,id:nid(),ts:now(),day:today(),q:-d.q,qb:-d.qb,rev:-d.rev,cost:-d.cost}));
 const net=R(sum(db.pay.filter(p=>p.inv==id),p=>p.amt));if(net>0)pay(i,-net,i.m,'refund');
 const c=i.c&&cust(i.c),o=owed(i);if(c&&o>0){c.bal=R(c.bal-o);led(c.id,id,0,o,'إلغاء فاتورة #'+id)}
 i.void=1;i.voidWhy=why||'';log('cancel',{inv:id,why})}
const _edit=(id,pw,cart,cf)=>{_cancel(id,pw,'تعديل');const n=_sell(cart,cf);n.editOf=id;log('edit',{old:id,new:n.id});return n};

/* الحجز: عربون فقط، والإيراد يُحتسب عند التسليم */
function _reserve(cid,pid,q,exp,t,paid,m){const p=prod(pid);if(!p||!(q>0))fail('بيانات ناقصة');if(!exp||exp<today())fail('تاريخ انتهاء الحجز إلزامي ويجب ألا يكون ماضياً');
 if(p.cost==null)fail('حدّد سعر التكلفة أولاً');const tot=R(q*p.price);paid=t=='cash'?tot:R(+paid||0);if(paid<0||paid>tot)fail('المدفوع أكبر من قيمة الحجز');
 p.res=R((p.res||0)+q);const i={id:nid(),ts:now(),day:today(),c:cid,t,m:m||'cash',s:tot,d:0,v:0,fee:0,tot,paid,red:0,site:'حجز',
  items:[{pid,n:p.n,u:p.units[0].n,f:1,q,pr:p.price,np:p.price,cp:p.cost,r:0,rsv:1}]};
 db.inv.push(i);db.rsv.push({id:nid(),c:cid,pid,q,drawn:0,exp,price:p.price,inv:i.id,st:'open'});
 if(paid)pay(i,paid,i.m,'deposit');if(t=='credit'){const c=cust(cid);c.bal=R(c.bal+tot-paid);led(cid,i.id,tot,0,'حجز #'+i.id);if(paid)led(cid,i.id,0,paid,'عربون حجز')}
 log('reserve',{inv:i.id});return i}
function _deliver(rid,a){const r=db.rsv.find(x=>x.id==rid),l=R(r.q-r.drawn);if(r.st!='open')fail('الحجز غير فعّال');if(!(a>0)||a>l)fail('كمية غير صحيحة');
 const p=prod(r.pid),i=inv(r.inv);p.qty-=a;p.res=Math.max(0,R(p.res-a));r.drawn=R(r.drawn+a);dl(i,i.items[0],a);if(r.drawn>=r.q)r.st='done';log('deliver',{rid,a})}
const _exp=()=>{let n=0;db.rsv.forEach(r=>{const l=R(r.q-r.drawn);if(r.st!='open'||l<=0||r.exp>=today())return;const p=prod(r.pid),i=inv(r.inv);
 p.res=Math.max(0,R((p.res||0)-l));r.st='released';r.rel=l;i.st='released';back(i,R(l*r.price),'فك حجز منتهٍ');log('release',{inv:i.id,l});n++});return n};

/* المخزن والموردون */
function _adjust(pid,nq,why,who){if(!why||!why.trim()||!who||!who.trim())fail('سبب التعديل واسم الموظف إلزاميان');nq=+nq;if(isNaN(nq))fail('كمية غير صحيحة');
 const p=prod(pid);db.stk.push({id:nid(),ts:now(),day:today(),pid,n:p.n,old:p.qty,nw:nq,why:why.trim(),who:who.trim()});p.qty=nq}
function _supIn(sid,pid,q,cost,paid,m){q=+q;cost=+cost;paid=R(+paid||0);const s=db.sup.find(x=>x.id==sid),p=prod(pid);if(!s||!p)fail('بيانات ناقصة');
 if(!(q>0)||!(cost>=0))fail('قيم غير صحيحة');const tot=R(q*cost);if(paid<0||paid>tot)fail('المدفوع أكبر من قيمة الفاتورة');
 p.qty+=q;p.cost=cost;s.bal=R(s.bal+tot-paid);const id=nid();db.sin.push({id,ts:now(),day:today(),sid,pid,n:p.n,q,cost,tot,paid});
 if(paid)db.spay.push({id:nid(),ts:now(),day:today(),sid,inv:id,amt:paid,m:m||'cash'});return id}
function _supPay(sid,amt,m){const s=db.sup.find(x=>x.id==sid);amt=R(amt);if(!(amt>0)||amt>s.bal)fail('المبلغ أكبر من المستحق للمورد');s.bal=R(s.bal-amt);db.spay.push({id:nid(),ts:now(),day:today(),sid,inv:0,amt,m:m||'cash'})}
const supLedger=sid=>{let b=0;return[...db.sin.filter(x=>x.sid==sid).map(x=>({ts:x.ts,day:x.day,desc:`وارد ${x.n} × ${x.q}`,d:x.tot,cr:0})),...db.spay.filter(x=>x.sid==sid).map(x=>({ts:x.ts,day:x.day,desc:'سداد',d:0,cr:x.amt}))].sort((a,z)=>a.ts-z.ts).map(e=>(b=R(b+e.d-e.cr),{...e,bal:b}))};
const custLedger=cid=>{let b=0;return db.led.filter(e=>e.c==cid).sort((a,z)=>a.ts-z.ts||a.id-z.id).map(e=>(b=R(b+e.d-e.cr),{...e,bal:b}))};
const autoRO=(p,days=30,lead=7)=>{const a=Date.now()-days*864e5,s=sum(db.dlv.filter(d=>d.pid==p.id&&d.ts>a),d=>d.qb);return Math.max(1,Math.ceil(s/days*lead*1.5))};
const isLow=p=>p.qty<=(p.ro??db.shop.low);

/* مصدر واحد للحقيقة: النقدية والأرباح */
const dayR=d=>[new Date(d+'T00:00').getTime()-1,new Date(d+'T23:59:59.999').getTime()];
function cashbox(a,b){const P=db.pay.filter(x=>x.ts>a&&x.ts<=b),by=f=>R(sum(P.filter(f),x=>x.amt));
 return{cash:by(x=>x.m=='cash'),card:by(x=>x.m=='card'),wallet:by(x=>x.m=='wallet'),sale:by(x=>x.k=='sale'),collect:by(x=>x.k=='collect'),deposit:by(x=>x.k=='deposit'),refund:by(x=>x.k=='refund'),
  supOut:R(sum(db.spay.filter(x=>x.ts>a&&x.ts<=b&&x.m=='cash'),x=>x.amt)),
  rev:R(sum(db.dlv.filter(x=>x.ts>a&&x.ts<=b),x=>x.rev)),profit:R(sum(db.dlv.filter(x=>x.ts>a&&x.ts<=b),x=>x.rev-x.cost))}}
function profit(from,to){const D=db.dlv.filter(d=>d.day>=from&&d.day<=to),g=f=>{const o={};D.forEach(d=>{const r=o[f(d)]=o[f(d)]||{rev:0,cost:0};r.rev+=d.rev;r.cost+=d.cost});
 Object.values(o).forEach(r=>{r.rev=R(r.rev);r.cost=R(r.cost);r.profit=R(r.rev-r.cost)});return o};
 return{byItem:g(d=>d.n),byInvoice:g(d=>'#'+d.inv),total:R(sum(D,d=>d.rev-d.cost))}}

window.Core={migrate,sell:T(_sell),ret:T(_ret),collect:T(_collect),cancel:T(_cancel),edit:T(_edit),reserve:T(_reserve),deliver:T(_deliver),
 expire:()=>db.rsv.some(r=>r.st=='open'&&r.q>r.drawn&&r.exp<today())?tx(_exp):0,adjust:T(_adjust),supIn:T(_supIn),supPay:T(_supPay),
 supLedger,custLedger,autoRO,isLow,cashbox,dayR,profit,owed,isAdmin};

/* ===== ربط الواجهة الحالية بالمحرك ===== */
Core.migrate();
const E_=e=>alert(e.message);
window.fin=()=>{try{const i=Core.sell(cart,cf);cart=[];newCf();sched();toast('تم البيع بنجاح');showInv(i.id,1)}catch(e){E_(e)}};
window.ret=(id,j)=>{try{Core.ret(id,j,+val('rq'+j));sched();showInv(id)}catch(e){E_(e)}};
window.collect=id=>{try{const a=Core.collect(id,+val('am'+id),'cash'),c=cust(id);sched();txt('وصل استلام',`${db.shop.n}\nالتاريخ: ${today()}\nاستلمنا من: ${c.n}\nمبلغ: ${m(a)}\nالمتبقي عليه: ${m(c.bal)}${c.cr?'\nرصيد دائن: '+m(c.cr):''}`);render()}catch(e){E_(e)}};
window.doRsv=cid=>{try{const i=Core.reserve(cid,+val('rsp'),+val('rsq'),val('rse'),val('rst'),+val('rsd'),'cash');sched();toast('تم الحجز (عربون — الإيراد عند التسليم)');showInv(i.id)}catch(e){E_(e)}};
window.dlv=id=>{try{Core.deliver(id,+val('dl'+id));toast('تم التسليم وتسجيل الإيراد');rsvDash()}catch(e){E_(e)}};
window.delP=id=>{const p=prod(id);if(db.inv.some(i=>i.items.some(x=>x.pid==id))){p.off=!p.off;toast(p.off?'تم إيقاف البيع':'أُعيد تفعيل المنتج')}else if(confirm('حذف المنتج؟'))db.prods=db.prods.filter(q=>q.id!=id);save();render()};
window.updP=id=>{const p=prod(id);try{const pr=+val('pp'+id),c=prompt('سعر التكلفة (إجباري)',p.cost??'');if(!(pr>=0)||c===null||c===''||!(+c>=0))return alert('سعر البيع والتكلفة إجباريان ولا يقبلان السالب');
 const nq=+val('pq'+id);if(nq!=p.qty)Core.adjust(id,nq,prompt('سبب التعديل (تلف / عجز جرد ...)'),prompt('اسم الموظف المسؤول'));p.price=pr;p.cost=+c;save();render()}catch(e){E_(e);render()}};
const _a=window.addP;window.addP=()=>{const n=db.prods.length;_a();if(db.prods.length>n){const p=db.prods[n],c=prompt('سعر التكلفة (إجباري)');if(c===null||c===''||!(+c>=0)){db.prods.pop();save();render();return alert('سعر التكلفة إجباري — لم يُحفظ المنتج')}p.cost=+c;p.ro=db.shop.low;save()}};
window.cancelInv=id=>{const pw=prompt('كلمة سر المدير'),w=prompt('سبب الإلغاء');try{Core.cancel(id,pw,w);sched();cl();toast('تم إلغاء الفاتورة وإعادة الكميات')}catch(e){E_(e)}};
window.zrep=()=>{const t=db.sh,t1=Date.now(),b=Core.cashbox(t,t1);db.sh=t1;save();window._z=[t,t1];
 modal(`<h3>تقرير إغلاق الوردية</h3><pre>${E(`${db.shop.n}\n${new Date().toLocaleString('ar-EG')}\nنقدية فعلية بالدرج: ${m(b.cash)}\n  مبيعات نقدية/مدفوع عند البيع: ${m(b.sale)}\n  تحصيلات: ${m(b.collect)}\n  عربون حجوزات: ${m(b.deposit)}\n  مرتجعات: ${m(b.refund)}\nفيزا/شبكة: ${m(b.card)}\nمحافظ: ${m(b.wallet)}\nإيراد معترف به: ${m(b.rev)}`)}</pre><button class="b a" style="margin-top:10px" onclick="zdet(_z[0],_z[1])">📋 تفاصيل</button>`)};
window.alerts=()=>{const a=[];db.rsv.forEach(r=>{if(r.st=='open'&&r.q>r.drawn)a.push({d:r.exp,m:`⚠️ ينتهي غداً حجز ${prod(r.pid).n} للعميل ${cust(r.c).n}`})});
 db.cust.forEach(c=>{if(c.due&&c.bal>0)a.push({d:c.due,m:`💰 يستحق غداً سداد ${m(c.bal)} من ${c.n}`})});return a};
const rel=()=>{try{const n=Core.expire();if(n){sched();toast('تم فك '+n+' حجز منتهٍ وإعادة الكميات للبيع','#d97706')}}catch(e){}};
rel();setInterval(rel,6e4);
})();
