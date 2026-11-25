INSERT INTO businesses(id,display_name,timezone,opens,closes,weekdays)
VALUES ('demo','Juniper Demo Barbers','America/New_York',540,1020,ARRAY[1,2,3,4,5,6,7]),
('other','Cedar Demo Barbers','America/New_York',540,1020,ARRAY[1,2,3,4,5,6,7]);
INSERT INTO services(id,business_id,name,duration,buffer,price)
VALUES ('cut','demo','Demo haircut',30,15,3500),('trim','demo','Demo trim',15,0,2000),('cut','other','Other shop haircut',30,15,3500);
