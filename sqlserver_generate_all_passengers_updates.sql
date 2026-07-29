-- ═══════════════════════════════════════════════════════════════
--  Generiše UPDATE naredbe za popunjavanje all_passengers u Supabase
--
--  Šta radi:
--   1) Poziva istu proceduru kao i za rooming list export (dbo.up_api_context_init_Freedom),
--      za sjutrašnje dolaske - NE dira, ne mijenja postojeću proceduru niti postojeći
--      rooming list export/upit.
--   2) Iz JSON odgovora uzima samo claim_inc (broj rezervacije) za svaku rezervaciju.
--   3) Za svaki claim_inc povlači SVA imena putnika iz dbo.people (gdje više redova
--      dijeli isti claim), spojena u jedan tekst razdvojen sa "; ".
--   4) Kao rezultat vraća gotove UPDATE naredbe (Postgres sintaksa) - te naredbe samo
--      kopiraš i pokreneš u Supabase SQL editoru, POSLIJE što uvezeš rooming list
--      Excel kao i do sad. Redoslijed: prvo normalan uvoz u app, pa ovo.
--
--  Napomena: ako neka rezervacija u dbo.people nema zapisan claim (npr. podaci još
--  nisu stigli), ta rezervacija se jednostavno neće pojaviti u rezultatu - ništa se
--  neće pokvariti, samo za nju all_passengers ostaje prazno (NULL) i ugovor će i
--  dalje raditi po starom (ponavlja jedno ime).
-- ═══════════════════════════════════════════════════════════════

declare
    @session_token uniqueidentifier,
    @sheets_count int,
    @sheet_number int,
    @response nvarchar(max),
    @inparams nvarchar(max),
    @Message nvarchar(max) = '',
    @DateBeg date = dateadd(day, 1, cast(getdate() as date)),  -- sjutra; promijeni ručno ako treba drugi datum
    @DateEnd date = dateadd(day, 1, cast(getdate() as date));

set @inparams = N'{
    "DateBegIn": "' + convert(nvarchar(10), @DateBeg, 23) + N'",
    "DateEndIn": "' + convert(nvarchar(10), @DateEnd, 23) + N'",
    "sheetsnumber": 1
}';

-------------------------------

drop table if exists #Responses;
create table #Responses (
    sheet_number int not null,
    response nvarchar(max) null
);

exec dbo.up_api_context_init_Freedom
    @token = null,
    @context = 'roominglist',
    @inparams = @inparams,
    @session_token = @session_token output,
    @sheets_count = @sheets_count output,
    @sheet_number = @sheet_number output,
    @response = @response output;

insert into #Responses (sheet_number, response)
values (@sheet_number, @response);

while @sheet_number < @sheets_count
begin
    set @sheet_number = @sheet_number + 1;

    set @inparams = N'{"sheetsnumber": ' + convert(nvarchar(20), @sheet_number) + N'}';

    exec dbo.up_api_context_init_Freedom
        @token = @session_token,
        @context = 'roominglist',
        @inparams = @inparams,
        @sheet_number = @sheet_number output,
        @response = @response output;

    insert into #Responses (sheet_number, response)
    values (@sheet_number, @response);
end;

select @Message = @Message + isnull(r.response, N'')
from #Responses r
order by r.sheet_number;

-------------------------------
-- Sva imena po claim_inc + gotove UPDATE naredbe za Supabase
-------------------------------

;with claims as (
    select distinct try_convert(int, json_value(j.value, '$.claim.inc')) as claim_inc
    from openjson(@Message, '$.data') j
    where isjson(@Message) = 1
),
names as (
    select
        c.claim_inc,
        string_agg(
            concat(ltrim(rtrim(p.firstname)), N' ', ltrim(rtrim(p.lastname))),
            N'; '
        ) within group (order by p.lastname, p.firstname) as svi_gosti
    from claims c
    inner join dbo.people p
        on p.claim = convert(nvarchar(50), c.claim_inc)
    where c.claim_inc is not null
    group by c.claim_inc
)
select
    claim_inc,
    svi_gosti,
    N'update rooming_list set all_passengers = '''
        + replace(svi_gosti, N'''', N'''''')
        + N''' where claim_inc = ' + convert(nvarchar(20), claim_inc) + N';' as update_stmt
from names
where svi_gosti is not null
order by claim_inc;

-- Kopiraj kolonu "update_stmt" (sve redove) i zalijepi/pokreni u Supabase SQL editoru.
