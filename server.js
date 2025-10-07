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
  const { 
    query, 
    regions = [],
    maxExperience = '',
    maxEducation = '',
    maxPages = 5
  } = req.body;
  
  let browser;
  const allJobs = [];
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('🔍 Starting scrape...');
    console.log('Filters:', { query, regions, maxExperience, maxEducation });
    
    // 사람인 크롤링
    for (let page = 1; page <= maxPages; page++) {
      try {
        const jobs = await scrapeSaramin(browser, query, page);
        allJobs.push(...jobs);
        console.log(`Saramin page ${page}: ${jobs.length} jobs`);
        if (jobs.length === 0) break;
      } catch (err) {
        console.error(`Saramin page ${page} error:`, err.message);
        break;
      }
    }
    
    // 잡코리아 크롤링
    for (let page = 1; page <= maxPages; page++) {
      try {
        const jobs = await scrapeJobKorea(browser, query, page);
        allJobs.push(...jobs);
        console.log(`JobKorea page ${page}: ${jobs.length} jobs`);
        if (jobs.length === 0) break;
      } catch (err) {
        console.error(`JobKorea page ${page} error:`, err.message);
        break;
      }
    }
    
    await browser.close();
    
    // 스마트 필터링
    let filtered = allJobs;
    
    // 지역 필터 (여러 지역 OR 조건)
    if (regions.length > 0) {
      filtered = filtered.filter(job => 
        regions.some(region => job.location.includes(region))
      );
    }
    
    // 경력 필터 (내 경력 이하만)
    if (maxExperience) {
      const maxExp = parseInt(maxExperience);
      filtered = filtered.filter(job => {
        if (!job.experience) return true; // 경력 정보 없으면 포함
        
        const exp = job.experience.toLowerCase();
        
        // "신입" 또는 "경력무관" 포함
        if (exp.includes('신입') || exp.includes('무관')) return true;
        
        // 숫자 추출
        const match = exp.match(/(\d+)/);
        if (match) {
          const requiredExp = parseInt(match[1]);
          return requiredExp <= maxExp;
        }
        
        return true;
      });
    }
    
    // 학력 필터 (내 학력 이하만)
    if (maxEducation) {
      const eduLevels = ['학력무관', '고졸', '초대졸', '대졸', '석사', '박사'];
      const maxEduIndex = parseInt(maxEducation);
      const allowedEdu = eduLevels.slice(0, maxEduIndex + 1);
      
      filtered = filtered.filter(job => {
        if (!job.education) return true;
        
        // 허용된 학력 중 하나라도 포함되면 OK
        return allowedEdu.some(edu => job.education.includes(edu));
      });
    }
    
    console.log(`✅ Total: ${allJobs.length}, Filtered: ${filtered.length}`);
    res.json({ 
      jobs: filtered,
      total: allJobs.length,
      filtered: filtered.length
    });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error.message);
    res.json({ jobs: [], total: 0, filtered: 0, error: error.message });
  }
});

async function scrapeSaramin(browser, query, pageNum) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}&recruitPage=${pageNum}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.item_recruit', { timeout: 10000 }).catch(() => {});
  
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.item_recruit').forEach(el => {
      const conditions = el.querySelectorAll('.job_condition span');
      results.push({
        title: el.querySelector('.job_tit a')?.innerText.trim() || '',
        company: el.querySelector('.corp_name a')?.innerText.trim() || '',
        location: conditions[0]?.innerText.trim() || '',
        experience: conditions[1]?.innerText.trim() || '',
        education: conditions[2]?.innerText.trim() || '',
        link: el.querySelector('.job_tit a')?.href || '',
        source: 'Saramin'
      });
    });
    return results;
  });
  
  await page.close();
  return jobs.filter(job => job.title && job.company);
}

async function scrapeJobKorea(browser, query, pageNum) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(query)}&Page_No=${pageNum}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.recruit-info', { timeout: 10000 }).catch(() => {});
  
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.recruit-info').forEach(el => {
      results.push({
        title: el.querySelector('.title')?.innerText.trim() || '',
        company: el.querySelector('.corp-name a')?.innerText.trim() || '',
        location: el.querySelector('.option .loc')?.innerText.trim() || '',
        experience: el.querySelector('.option .exp')?.innerText.trim() || '',
        education: el.querySelector('.option .edu')?.innerText.trim() || '',
        link: el.querySelector('.title')?.href || '',
        source: 'JobKorea'
      });
    });
    return results;
  });
  
  await page.close();
  return jobs.filter(job => job.title && job.company);
}

app.post('/api/scrape/real-estate', (req, res) => {
  res.json({ properties: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
