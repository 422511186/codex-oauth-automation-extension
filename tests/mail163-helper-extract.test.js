const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runHelperExtraction(scriptBody) {
  const result = spawnSync('python', ['-X', 'utf8', '-c', scriptBody], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'python command failed');
  }

  return JSON.parse(result.stdout);
}

test('mail163 helper extracts the ChatGPT verification code instead of unrelated six-digit HTML noise', () => {
  const helperPath = path.join(process.cwd(), 'scripts', 'mail163_helper.py').replace(/\\/g, '\\\\');
  const payload = runHelperExtraction(`
import importlib.util
import json

helper_path = r"${helperPath}"
spec = importlib.util.spec_from_file_location("mail163_helper", helper_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

html_mail = """
<html>
  <head>
    <style>
      .m_202123_hidden { display: none; }
    </style>
    <script>
      const ignoredNumber = "202123";
    </script>
  </head>
  <body>
    <div>输入此临时验证码以继续：<strong>994680</strong></div>
    <p>如果你无意登录 ChatGPT，请重置密码。</p>
  </body>
</html>
"""

plain_text = module._html_to_text(html_mail)
result = module._extract_verification_code("你的临时 ChatGPT 登录代码\\n" + plain_text)

print(json.dumps({
  "plainText": plain_text,
  "result": result,
}, ensure_ascii=False))
`);

  assert.match(payload.plainText, /输入此临时验证码以继续：\s*994680/);
  assert.equal(payload.result.code, '994680');
  assert.equal(payload.result.source, 'cn_forward');
});

test('mail163 helper does not accept an arbitrary six-digit number without verification wording', () => {
  const helperPath = path.join(process.cwd(), 'scripts', 'mail163_helper.py').replace(/\\/g, '\\\\');
  const payload = runHelperExtraction(`
import importlib.util
import json

helper_path = r"${helperPath}"
spec = importlib.util.spec_from_file_location("mail163_helper", helper_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = module._extract_verification_code("页面埋点编号 202123，主题是 ChatGPT 邮件通知。")
print(json.dumps({"result": result}, ensure_ascii=False))
`);

  assert.equal(payload.result, null);
});

test('mail163 helper extracts the step 8 English ChatGPT login code template', () => {
  const helperPath = path.join(process.cwd(), 'scripts', 'mail163_helper.py').replace(/\\/g, '\\\\');
  const payload = runHelperExtraction(`
import importlib.util
import json

helper_path = r"${helperPath}"
spec = importlib.util.spec_from_file_location("mail163_helper", helper_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

mail_text = """
ChatGPT Log-in Code

Hi there,

We noticed a suspicious log-in on your account. If that was you, enter this code:

016954

If you were not trying to log in to ChatGPT, please reset your password.
"""

result = module._extract_verification_code(mail_text)
print(json.dumps({"result": result}, ensure_ascii=False))
`);

  assert.equal(payload.result.code, '016954');
  assert.equal(payload.result.source, 'en_forward');
});
