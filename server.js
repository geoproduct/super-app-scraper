const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'OK' });
});

// 사람인 + 잡코리아 동시 크롤링
app.post('/api/scrape/jobs', async (req, res) => {
  const { 
    query, 
    location = '', 
    experience = '', 
    education = '', 
    salary = '',
    maxPages = 5  // 최대 5페이지 (100개 공고)
  } = req.body;
  
  let browser;
  const allJobs = [];
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    // 1. 사람인 크롤링
    console.log('🔍 Scraping Saramin...');
    for (let page = 1; page <= maxPages; page++) {
      try {
        const saraminJobs = await scrapeSaramin(browser, query, page);
        allJobs.push(...saraminJobs);
        console.log(`Saramin page ${page}: ${saraminJobs.length} jobs`);
        
        if (saraminJobs.length === 0) break;
      } catch (err) {
        console.error(`Saramin page ${page} error:`, err.message);
        break;
      }
    }
    
    // 2. 잡코리아 크롤링
    console.log('🔍 Scraping JobKorea...');
    for (let page = 1; page <= maxPages; page++) {
      try {
        const jobkoreaJobs = await scrapeJobKorea(browser, query, page);
        allJobs.push(...jobkoreaJobs);
        console.log(`JobKorea page ${page}: ${jobkoreaJobs.length} jobs`);
        
        if (jobkoreaJobs.length === 0) break;
      } catch (err) {
        console.error(`JobKorea page ${page} error:`, err.message);
        break;
      }
    }
    
    await browser.close();
    
    // 3. 필터링 적용
    let filteredJobs = allJobs;
    
    if (location) {
      filteredJobs = filteredJobs.filter(job => 
        job.location.includes(location)
      );
    }
    
    if (experience) {
      filteredJobs = filteredJobs.filter(job => 
        job.experience && job.experience.includes(experience)
      );
    }
    
    if (education) {
      filteredJobs = filteredJobs.filter(job => 
        job.education && job.education.includes(education)
      );
    }
    
    console.log(`✅ Total: ${allJobs.length} jobs, Filtered: ${filteredJobs.length} jobs`);
    res.json({ 
      jobs: filteredJobs,
      total: allJobs.length,
      filtered: filteredJobs.length
    });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌ Error:', error.message);
    res.json({ jobs: [], error: error.message });
  }
});

// 사람인 크롤링 함수
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

// 잡코리아 크롤링 함수
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
