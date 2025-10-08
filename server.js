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
  const { query, regions = [], maxExperience = '', maxEducation = '', maxPages = 5 } = req.body;
  
  let browser;
  const allJobs = [];
  const stats = { saramin: 0, jobkorea: 0, incruit: 0, wanted: 0, companies: 0 };
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log('🔍 Query:', query);
    
    // 1. 사람인
    console.log('📍 Saramin...');
    for (let p = 1; p <= maxPages; p++) {
      try {
        const jobs = await scrapeSaramin(browser, query, p);
        allJobs.push(...jobs);
        stats.saramin += jobs.length;
        console.log(`  P${p}: ${jobs.length}`);
        if (jobs.length === 0) break;
      } catch (e) {
        console.error(`Saramin:`, e.message);
        break;
      }
    }
    
    // 2. 잡코리아
    console.log('📍 JobKorea...');
    try {
      const jobs = await scrapeJobKorea(browser, query, Math.min(maxPages, 3));
      allJobs.push(...jobs);
      stats.jobkorea = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`JobKorea:`, e.message);
    }
    
    // 3. 인크루트
    console.log('📍 Incruit...');
    try {
      const jobs = await scrapeIncruit(browser, query, 3);
      allJobs.push(...jobs);
      stats.incruit = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Incruit:`, e.message);
    }
    
    // 4. 원티드
    console.log('📍 Wanted...');
    try {
      const jobs = await scrapeWanted(browser, query);
      allJobs.push(...jobs);
      stats.wanted = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Wanted:`, e.message);
    }
    
    // 5. 기업 채용 사이트
    console.log('📍 Company Careers...');
    try {
      const jobs = await scrapeCompanyCareers(browser, query);
      allJobs.push(...jobs);
      stats.companies = jobs.length;
      console.log(`  Total: ${jobs.length}`);
    } catch (e) {
      console.error(`Companies:`, e.message);
    }
    
    await browser.close();
    console.log('📊', stats);
    
    // 필터링
    let filtered = allJobs;
    
    // 1. 검색어 관련성 필터링
    if (query && query.trim().length > 0) {
      const queryKeywords = query.toLowerCase()
        .replace(/[^a-z0-9가-힣\s]/g, ' ')
        .split(/\s+/)
        .filter(k => k.length >= 2);
      
      if (queryKeywords.length > 0) {
        filtered = filtered.filter(job => {
          const searchText = (job.title + ' ' + job.company).toLowerCase();
          const hasKeyword = queryKeywords.some(keyword => searchText.includes(keyword));
          const validTitleLength = job.title.length <= 150;
          const noUrlInTitle = !job.title.includes('http');
          
          return hasKeyword && validTitleLength && noUrlInTitle;
        });
      }
    }
    
    // 2. 지역 필터
    if (regions.length > 0) {
      filtered = filtered.filter(j => regions.some(r => j.location.includes(r)));
    }
    
    // 3. 경력 필터
    if (maxExperience) {
      const maxExp = parseInt(maxExperience);
      filtered = filtered.filter(j => {
        if (!j.experience) return true;
        if (j.experience.includes('신입') || j.experience.includes('무관')) return true;
        const m = j.experience.match(/(\d+)/);
        return m ? parseInt(m[1]) <= maxExp : true;
      });
    }
    
    // 4. 학력 필터
    if (maxEducation) {
      const edu = ['학력무관', '고졸', '초대졸', '대졸', '석사', '박사'];
      const allowed = edu.slice(0, parseInt(maxEducation) + 1);
      filtered = filtered.filter(j => !j.education || allowed.some(e => j.education.includes(e)));
    }
    
    console.log(`✅ Total: ${allJobs.length}, Filtered: ${filtered.length}`);
    res.json({ jobs: filtered, total: allJobs.length, filtered: filtered.length, stats });
    
  } catch (error) {
    if (browser) await browser.close();
    console.error('❌', error.message);
    res.json({ jobs: [], total: 0, filtered: 0, error: error.message });
  }
});

async function scrapeSaramin(browser, query, page) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  await p.goto(`https://www.saramin.co.kr/zf_user/search?searchword=${encodeURIComponent(query)}&recruitPage=${page}`, 
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('.item_recruit', { timeout: 10000 }).catch(() => {});
  
  const jobs = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('.item_recruit')).map(el => {
      const cond = el.querySelectorAll('.job_condition span');
      return {
        title: el.querySelector('.job_tit a')?.innerText.trim() || '',
        company: el.querySelector('.corp_name a')?.innerText.trim() || '',
        location: cond[0]?.innerText.trim() || '',
        experience: cond[1]?.innerText.trim() || '',
        education: cond[2]?.innerText.trim() || '',
        link: el.querySelector('.job_tit a')?.href || '',
        source: 'Saramin'
      };
    }).filter(j => j.title && j.company);
  });
  
  await p.close();
  return jobs;
}

async function scrapeJobKorea(browser, query, maxPages) {
  const jobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await p.setViewport({ width: 1920, height: 1080 });
      
      await p.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      });
      
      const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(query)}&Page_No=${page}`;
      await p.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
      await p.waitForTimeout(5000);
      await p.waitForSelector('a[href*="Recruit/GI_Read"]', { timeout: 10000 }).catch(() => {});
      
      const pageJobs = await p.evaluate(() => {
        const results = [];
        const seenLinks = new Set();
        const links = document.querySelectorAll('a[href*="Recruit/GI_Read"]');
        
        links.forEach(link => {
          const href = link.href;
          if (seenLinks.has(href)) return;
          seenLinks.add(href);
          
          try {
            const container = link.closest('div[class*="Flex_gap"], div[class*="list"], article');
            if (!container) return;
            
            const companyEl = container.querySelector('[class*="Typography_variant_size16"], [class*="company"]');
            const company = companyEl?.textContent?.trim() || '회사명없음';
            
            const titleEl = container.querySelector('[class*="Typography_variant_size18"], [class*="title"], h3, h2');
            const title = titleEl?.textContent?.trim() || link.textContent?.trim() || '';
            
            const detailEls = container.querySelectorAll('[class*="Typography_variant_size14"], [class*="condition"] span');
            let location = '';
            let experience = '';
            let education = '';
            
            detailEls.forEach(el => {
              const text = el.textContent?.trim() || '';
              if (text.includes('서울') || text.includes('경기') || text.includes('부산') || text.includes('대구')) {
                location = text;
              } else if (text.includes('신입') || text.includes('경력') || text.includes('년↑')) {
                experience = text;
              } else if (text.includes('대졸') || text.includes('고졸') || text.includes('학력무관')) {
                education = text;
              }
            });
            
            if (title && title.length > 3) {
              results.push({
                title,
                company,
                location: location || '지역정보없음',
                experience: experience || '경력무관',
                education: education || '학력무관',
                link: href,
                source: 'JobKorea'
              });
            }
          } catch (e) {
            console.error('Parsing error:', e);
          }
        });
        
        return results;
      });
      
      console.log(`JobKorea page ${page}: ${pageJobs.length} jobs`);
      await p.close();
      jobs.push(...pageJobs);
      
      if (pageJobs.length === 0) break;
      
    } catch (err) {
      console.error(`JobKorea page ${page}:`, err.message);
      break;
    }
  }
  
  return jobs.filter((j, i, arr) => arr.findIndex(x => x.link === j.link) === i).slice(0, 100);
}
async function scrapeIncruit(browser, query, maxPages) {
  const jobs = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await p.setViewport({ width: 1920, height: 1080 });
      
      // 여러 URL 패턴 시도
      const urls = [
        `http://job.incruit.com/entry/searchjob.asp?ct=12&ty=1&cd=1&kw=${encodeURIComponent(query)}&articlecount=60&page=${page}`,
        `http://job.incruit.com/jobdb_list/searchjob.asp?ct=1&kw=${encodeURIComponent(query)}&page=${page}`,
        `http://www.incruit.com/search/list.asp?col=job&kw=${encodeURIComponent(query)}&page=${page}`
      ];
      
      let pageJobs = [];
      
      for (const url of urls) {
        try {
          console.log(`Incruit trying: ${url}`);
          await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await p.waitForTimeout(5000);
          
          // 페이지 HTML 확인
          const hasContent = await p.evaluate(() => {
            const rows1 = document.querySelectorAll('#content > div:not(.entry-new2017) > div.n_job_list_table_a.list_full_default > table > tbody > tr');
            const rows2 = document.querySelectorAll('table tr, .cl_top, .n_job_list_default');
            console.log(`Selector 1: ${rows1.length} rows`);
            console.log(`Selector 2: ${rows2.length} rows`);
            return rows1.length > 0 || rows2.length > 0;
          });
          
          if (!hasContent) {
            console.log(`No content found with this URL`);
            continue;
          }
          
          pageJobs = await p.evaluate(() => {
            const results = [];
            
            // 방법 1: 원래 셀렉터
            let rows = document.querySelectorAll('#content > div:not(.entry-new2017) > div.n_job_list_table_a.list_full_default > table > tbody > tr');
            
            if (rows.length === 0) {
              // 방법 2: 더 일반적인 셀렉터
              rows = document.querySelectorAll('table.n_job_list_table_a tr, table tbody tr');
            }
            
            console.log(`Processing ${rows.length} rows`);
            
            rows.forEach(tr => {
              try {
                // 모든 a 태그 찾기
                const allLinks = tr.querySelectorAll('a');
                
                let title = '';
                let company = '';
                let link = '';
                
                // 링크에서 정보 추출
                allLinks.forEach(a => {
                  const href = a.getAttribute('href') || '';
                  const text = a.textContent?.trim() || '';
                  
                  if (href.includes('recruit') && text.length > 5) {
                    title = text;
                    link = href.includes('http') ? href : `http://job.incruit.com${href}`;
                  } else if (href.includes('company') && text.length > 2) {
                    company = text;
                  }
                });
                
                // 대체 방법: td 기반
                if (!title) {
                  const td2 = tr.querySelector('td:nth-child(2)');
                  if (td2) {
                    const titleA = td2.querySelector('a');
                    title = titleA?.textContent?.trim() || '';
                    link = titleA?.getAttribute('href') || '';
                    if (link && !link.includes('http')) link = `http://job.incruit.com${link}`;
                  }
                }
                
                if (!company) {
                  const th = tr.querySelector('th');
                  const companyA = th?.querySelector('a');
                  company = companyA?.textContent?.trim() || '';
                }
                
                // 지역 정보
                const td3 = tr.querySelector('td:nth-child(3)');
                const location = td3?.textContent?.trim().split('\n')[0] || '';
                
                if (title && title.length > 3 && company) {
                  results.push({
                    title: title.substring(0, 100),
                    company: company.substring(0, 50),
                    location: location || '지역정보없음',
                    experience: '경력무관',
                    education: '학력무관',
                    link: link || '',
                    source: 'Incruit'
                  });
                }
              } catch (e) {
                console.error('Row error:', e);
              }
            });
            
            return results;
          });
          
          console.log(`Incruit URL result: ${pageJobs.length} jobs`);
          
          if (pageJobs.length > 0) break;
          
        } catch (urlErr) {
          console.error(`Incruit URL error:`, urlErr.message);
        }
      }
      
      await p.close();
      jobs.push(...pageJobs);
      
      if (pageJobs.length === 0) break;
      
    } catch (err) {
      console.error(`Incruit page ${page}:`, err.message);
      break;
    }
  }
  
  return jobs.filter((j, i, arr) => arr.findIndex(x => x.link === j.link) === i).slice(0, 60);
}

async function scrapeWanted(browser, query) {
  const p = await browser.newPage();
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  
  const url = `https://www.wanted.co.kr/search?query=${encodeURIComponent(query)}&tab=position`;
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await p.waitForTimeout(5000);
  
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => window.scrollBy(0, 1000));
    await p.waitForTimeout(1000);
  }
  
  const jobs = await p.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('[class*="Card"], [class*="JobCard"], div[data-job-id]');
    
    cards.forEach(card => {
      try {
        const titleSelectors = [
          'h2[class*="JobCard"]',
          'h3[class*="JobCard"]',
          '[class*="JobCard_title"]',
          'div[class*="JobCard"] > a > strong',
          'a[class*="JobCard"] strong'
        ];
        
        let titleEl = null;
        for (const selector of titleSelectors) {
          titleEl = card.querySelector(selector);
          if (titleEl) break;
        }
        
        if (!titleEl) return;
        
        const fullTitle = titleEl.textContent?.trim() || '';
        const titleLines = fullTitle.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const cleanTitle = titleLines[0] || fullTitle;
        const title = cleanTitle.length > 100 ? cleanTitle.substring(0, 100) + '...' : cleanTitle;
        
        if (fullTitle.length > 300) return;
        
        const companyEl = card.querySelector('[class*="company"], [class*="Company"]');
        const company = companyEl?.textContent?.trim() || '회사명없음';
        
        const locationEl = card.querySelector('[class*="location"], [class*="Location"]');
        const location = locationEl?.textContent?.trim() || '서울';
        
        const linkEl = card.querySelector('a[href*="/wd/"]');
        const link = linkEl ? `https://www.wanted.co.kr${linkEl.getAttribute('href')}` : '';
        
        if (title && title.length >= 5 && title.length <= 150 && !title.includes('http')) {
          results.push({
            title,
            company,
            location,
            experience: '경력무관',
            education: '학력무관',
            link,
            source: 'Wanted'
          });
        }
      } catch (e) {
        console.error('Card parsing error:', e);
      }
    });
    
    return results.filter((j, i, arr) => arr.findIndex(x => x.title === j.title) === i);
  });
  
  await p.close();
  return jobs.slice(0, 30);
}

async function scrapeCompanyCareers(browser, query) {
  const jobs = [];
  
  const companies = [
    { name: 'Kakao', url: 'https://careers.kakao.com/jobs', source: 'Kakao' },
    { name: 'Naver', url: 'https://recruit.navercorp.com/rcrt/list.do', source: 'Naver' },
    { name: 'Coupang', url: 'https://www.coupang.jobs/kr/jobs/', source: 'Coupang' },
    { name: 'Toss', url: 'https://toss.im/career/jobs', source: 'Toss' },
    { name: 'Daangn', url: 'https://team.daangn.com/jobs/', source: '당근마켓' }
  ];
  
  for (const company of companies) {
    try {
      const p = await browser.newPage();
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await p.goto(company.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await p.waitForTimeout(5000);
      
      // 스크롤 (동적 콘텐츠 로딩)
      for (let i = 0; i < 3; i++) {
        await p.evaluate(() => window.scrollBy(0, 1000));
        await p.waitForTimeout(1000);
      }
      
      const companyJobs = await p.evaluate((companyName, queryText) => {
        const results = [];
        const seenTitles = new Set();
        
        // 채용 공고 찾기
        document.querySelectorAll('a, li, div, article').forEach(el => {
          // 제목 추출
          const titleEl = el.querySelector('h3, h4, h5, [class*="title"], strong') || el;
          let title = titleEl.textContent?.trim() || '';
          
          // 너무 긴 텍스트 제외 (블로그 글 등)
          if (title.length > 200 || title.length < 10) return;
          
          // 검색어 포함 여부
          const queryLower = queryText.toLowerCase();
          const titleLower = title.toLowerCase();
          
          if (!titleLower.includes(queryLower)) return;
          
          // 중복 제거
          if (seenTitles.has(title)) return;
          seenTitles.add(title);
          
          // 링크 찾기
          const linkEl = el.tagName === 'A' ? el : el.closest('a') || el.querySelector('a');
          const link = linkEl?.href || '';
          
          // 유효성 검사
          if (link && !link.includes('javascript') && !link.includes('#')) {
            results.push({
              title: title.substring(0, 100),
              company: companyName,
              location: '서울',
              experience: '경력무관',
              education: '학력무관',
              link: link,
              source: companyName
            });
          }
        });
        
        return results.slice(0, 10);
      }, company.source, query);
      
      await p.close();
      jobs.push(...companyJobs);
      console.log(`${company.name}: ${companyJobs.length} jobs`);
      
    } catch (err) {
      console.error(`${company.name} error:`, err.message);
    }
  }
  
  return jobs.filter((j, i, arr) => arr.findIndex(x => x.link === j.link) === i);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server on ${PORT}`);
});
