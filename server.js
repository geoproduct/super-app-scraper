const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

app.post('/api/scrape/jobs', async (req, res) => {
  const { query } = req.body;
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    const page = await browser.newPage();
    
    // User-Agent 설정
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // 타임아웃 60초로 증가, waitUntil 조건 완화
    await page.goto(
      `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}`,
      { 
        waitUntil: 'domcontentloaded',  // networkidle0 대신 사용
        timeout: 60000 
      }
    );
    
    // 페이지 로딩 추가 대기
    await page.waitForSelector('.item_recruit', { timeout: 10000 }).catch(() => {});
    
    const jobs = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.item_recruit').forEach((el, idx) => {
        if (idx < 20) {
          results.push({
            title: el.querySelector('.job_tit a')?.innerText.trim() || '',
            company: el.querySelector('.corp_name a')?.innerText.trim() || '',
            location: el.querySelector('.job_condition span')?.innerText.trim() || '',
            link: el.querySelector('.job_tit a')?.href || '',
            salary: el.querySelectorAll('.job_condition span')[2]?.innerText.trim() || '회사내규'
          });
        }
      });
      return results;
    });
    
    await browser.close();
    console.log(`✅ Found ${jobs.length} jobs for: ${query}`);
    res.json({ jobs, count: jobs.length });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error.message);
    res.json({ jobs: [], error: error.message });
  }
});

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
