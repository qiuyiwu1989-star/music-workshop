/**
 * CubCopCat 后端一键建库脚本  ·  Phase 0
 * ------------------------------------------------------------------
 * 用 PocketBase JS SDK 的管理接口，创建 orgs / classes / works / progress
 * 四个 collection，扩展内置 users，并写好权限规则（API Rules）。
 *
 * 目标版本：PocketBase v0.23+（fields-based schema，_superusers 鉴权）。
 * 若你的 PB 版本更老（v0.22，用 schema 字段 + pb.admins 鉴权），
 * 请照 `后端设计.md` 第 1、2 节在 Admin UI 手动建（10 分钟，字段/规则都列全了）。
 *
 * 用法：
 *   1) 启动 PocketBase：  ./pocketbase serve --http=127.0.0.1:8090
 *   2) 建超管：          ./pocketbase superuser create <admin@you> <强密码>
 *   3) 装 SDK：          npm i pocketbase
 *   4) 运行：            PB_URL=http://127.0.0.1:8090 \
 *                        PB_ADMIN=admin@you PB_PASS=强密码 \
 *                        node setup-pb.mjs
 * ------------------------------------------------------------------
 */
import PocketBase from 'pocketbase';

const PB_URL   = process.env.PB_URL   || 'http://127.0.0.1:8090';
const PB_ADMIN = process.env.PB_ADMIN;
const PB_PASS  = process.env.PB_PASS;

if (!PB_ADMIN || !PB_PASS) {
  console.error('❌ 请设置环境变量 PB_ADMIN / PB_PASS（超级管理员账号密码）');
  process.exit(1);
}

const pb = new PocketBase(PB_URL);

// ---- 小工具：按名字找 collection，找不到返回 null ----
async function findCollection(name) {
  try { return await pb.collections.getFirstListItem(`name="${name}"`); }
  catch { return null; }
}
// ---- 创建或跳过 ----
async function ensureCollection(def) {
  const existing = await findCollection(def.name);
  if (existing) { console.log(`· ${def.name} 已存在，跳过`); return existing; }
  const created = await pb.collections.create(def);
  console.log(`✓ 创建 ${def.name}`);
  return created;
}

async function main() {
  // 1) 管理员登录（v0.23+ 用 _superusers）
  await pb.collection('_superusers').authWithPassword(PB_ADMIN, PB_PASS);
  console.log('✓ 管理员登录成功\n');

  // 2) 找到内置 users collection
  const users = await findCollection('users');
  if (!users) throw new Error('未找到内置 users collection，PB 版本异常');
  const usersId = users.id;

  // 3) orgs（机构）
  const orgs = await ensureCollection({
    name: 'orgs', type: 'base',
    fields: [
      { name: 'name', type: 'text', required: true, max: 60 },
      { name: 'note', type: 'text', required: false },
    ],
    listRule:   '@request.auth.id != ""',
    viewRule:   '@request.auth.id != ""',
    createRule: '@request.auth.role = "org_admin"',
    updateRule: '@request.auth.role = "org_admin"',
    deleteRule: '@request.auth.role = "org_admin"',
  });

  // 4) classes（班级）
  const classes = await ensureCollection({
    name: 'classes', type: 'base',
    fields: [
      { name: 'name',    type: 'text', required: true, max: 60 },
      { name: 'org',     type: 'relation', required: false, maxSelect: 1, collectionId: orgs.id },
      { name: 'teacher', type: 'relation', required: false, maxSelect: 1, collectionId: usersId },
      { name: 'term',    type: 'text', required: false, max: 30 },
    ],
    listRule:   '@request.auth.id != ""',
    viewRule:   '@request.auth.id != ""',
    createRule: '@request.auth.role = "teacher" || @request.auth.role = "org_admin"',
    updateRule: 'teacher = @request.auth.id || @request.auth.role = "org_admin"',
    deleteRule: '@request.auth.role = "org_admin"',
  });

  // 5) 扩展内置 users：role / org / klass；邮箱非必填（用户名登录）
  const userFields = users.fields || users.schema || [];
  const hasField = (n) => userFields.some(f => f.name === n);
  const extraUserFields = [];
  if (!hasField('role')) extraUserFields.push({
    name: 'role', type: 'select', required: false, maxSelect: 1,
    values: ['student', 'teacher', 'org_admin'],
  });
  if (!hasField('org'))   extraUserFields.push({ name: 'org',   type: 'relation', required: false, maxSelect: 1, collectionId: orgs.id });
  if (!hasField('klass')) extraUserFields.push({ name: 'klass', type: 'relation', required: false, maxSelect: 1, collectionId: classes.id });
  if (extraUserFields.length) {
    await pb.collections.update(usersId, {
      fields: [...userFields, ...extraUserFields],
      // Phase 1：允许自助注册；Phase 2 收紧为 '@request.auth.role="teacher"||...'
      createRule: '',
      updateRule: 'id = @request.auth.id',
    });
    console.log('✓ 扩展 users：role / org / klass');
  } else {
    console.log('· users 扩展字段已存在，跳过');
  }

  // 6) works（作品）★核心权限
  await ensureCollection({
    name: 'works', type: 'base',
    fields: [
      { name: 'student', type: 'relation', required: true,  maxSelect: 1, collectionId: usersId },
      { name: 'klass',   type: 'relation', required: false, maxSelect: 1, collectionId: classes.id },
      { name: 'title',   type: 'text',     required: false, max: 80 },
      { name: 'data',    type: 'json',     required: false, maxSize: 2000000 },
      { name: 'audio',   type: 'file',     required: false, maxSelect: 1, maxSize: 20000000 },
      { name: 'status',  type: 'select',   required: false, maxSelect: 1, values: ['draft', 'submitted', 'published'] },
    ],
    // 学生看自己；老师看本班；机构管理员看全部
    listRule: '@request.auth.id = student.id || klass.teacher = @request.auth.id || @request.auth.role = "org_admin"',
    viewRule: '@request.auth.id = student.id || klass.teacher = @request.auth.id || @request.auth.role = "org_admin"',
    createRule: '@request.auth.id != "" && student = @request.auth.id',
    updateRule: 'student = @request.auth.id',
    deleteRule: 'student = @request.auth.id',
  });

  // 7) progress（学习进度，迁移现有 Tasks/Quest）
  await ensureCollection({
    name: 'progress', type: 'base',
    fields: [
      { name: 'student',    type: 'relation', required: true, maxSelect: 1, collectionId: usersId },
      { name: 'lesson_key', type: 'text', required: true, max: 60 },
      { name: 'state',      type: 'json', required: false, maxSize: 100000 },
    ],
    listRule:   '@request.auth.id = student.id || @request.auth.role = "org_admin"',
    viewRule:   '@request.auth.id = student.id || @request.auth.role = "org_admin"',
    createRule: '@request.auth.id != "" && student = @request.auth.id',
    updateRule: 'student = @request.auth.id',
    deleteRule: 'student = @request.auth.id',
  });

  console.log('\n🎉 建库完成。打开 Admin 后台核对：' + PB_URL + '/_/');
}

main().catch(err => {
  console.error('\n❌ 出错：', err?.response || err?.message || err);
  process.exit(1);
});
