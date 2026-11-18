const { db }=require('../shared/database');
// Pontos indicativos de localização da delegação, não polígonos de jurisdição.
const list=[
 ['MAP-C','Maputo Cidade','Maputo Cidade',-25.965,32.583],['MAP-P','Maputo Província','Maputo',-25.87,32.47],['MAT','Matola','Maputo',-25.962,32.459],['BOA','Boane','Maputo',-26.04,32.33],['MAN','Manhiça','Maputo',-25.403,32.805],
 ['XAI','Xai-Xai','Gaza',-25.052,33.645],['CHI','Chibuto','Gaza',-24.69,33.53],['BIL','Bilene','Gaza',-25.27,33.24],
 ['INH','Inhambane','Inhambane',-23.87,35.39],['MAX','Maxixe','Inhambane',-23.86,35.35],['VIL','Vilankulo','Inhambane',-22.0,35.32],
 ['BEI','Beira','Sofala',-19.84,34.84],['DON','Dondo','Sofala',-19.61,34.74],['CHI-S','Chimoio','Manica',-19.12,33.48],['MAN-I','Manica','Manica',-18.94,32.87],
 ['TET','Tete','Tete',-16.16,33.59],['MOA','Moatize','Tete',-16.12,33.73],
 ['QUE','Quelimane','Zambézia',-17.88,36.89],['MOC','Mocuba','Zambézia',-16.84,36.98],['GUR','Gurúè','Zambézia',-15.47,36.98],
 ['NAM','Nampula','Nampula',-15.12,39.27],['NAC','Nacala','Nampula',-14.54,40.67],['ANG','Angoche','Nampula',-16.23,39.91],
 ['LIC','Lichinga','Niassa',-13.31,35.24],['CUE','Cuamba','Niassa',-14.80,36.54],
 ['PEM','Pemba','Cabo Delgado',-12.97,40.52],['MON','Montepuez','Cabo Delgado',-13.13,39.00]
];
const insert=db.prepare('INSERT OR IGNORE INTO delegations(code,name,province,lat,lng) VALUES(?,?,?,?,?)');for(const row of list)insert.run(...row);
function all(){return db.prepare('SELECT code,name,province,lat,lng FROM delegations ORDER BY province,name').all()}
module.exports={all};
